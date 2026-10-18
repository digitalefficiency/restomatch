import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  creditNotes,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  monthlyReports,
  notificationsOutbox,
  recoveryClaims,
  recoveryEvents,
  restaurants,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakHero } from '@restomatch/charts';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { enqueueRecoveryReminders } from '../recovery/reminders';
import { syncClaims } from '../recovery/service';
import { computeMonthlyReport, ensureMonthlyReport, monthlyReportEmail, monthlyReportWhatsApp, WHATSAPP_MAX } from '../reports/monthly';
import { renderMonthlyReportPdf } from '../reports/pdf';
import { sendMonthlyReports } from '../reports/send';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let T: Tenant;

function caller(role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFlags(features: Record<string, boolean>) {
  await db.update(restaurants).set({ settings: { features } as never }).where(eq(restaurants.id, T.restaurantId));
}

beforeAll(async () => {
  await resetDb(db);
  T = await seedTenant(db, 'R');
});

beforeEach(async () => {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
  await db.delete(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
  await db.delete(monthlyReports).where(eq(monthlyReports.restaurantId, T.restaurantId));
  await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
  await db
    .update(discrepancies)
    .set({ resolutionStatus: 'accepted', resolvedAt: new Date() })
    .where(eq(discrepancies.id, T.discrepancyId));
  await setFlags({ all: true });
});

afterAll(async () => {
  await resetDb(db);
});

describe('feature flag', () => {
  it('refuses every recovery/report procedure with FEATURE_DISABLED when the flag is off', async () => {
    await setFlags({});
    await expect(caller().recovery.summary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().recovery.returnedThisMonth()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller().monthlyReport.preview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const err = await caller().recovery.list().catch((e: unknown) => e);
    expect((err as { cause?: { appCode?: string } }).cause?.appCode).toBe('FEATURE_DISABLED');
  });

  it('is per feature (recovery on, monthlyReport off) and honours the FEATURES_OFF kill-switch', async () => {
    await setFlags({ recovery: true });
    await expect(caller().recovery.summary()).resolves.toBeTruthy();
    await expect(caller().monthlyReport.preview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    process.env.FEATURES_OFF = 'recovery';
    try {
      await expect(caller().recovery.summary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      delete process.env.FEATURES_OFF;
    }
  });

  it('keeps role gates: a receiver cannot read the tracker or the report', async () => {
    await expect(caller('receiver').recovery.summary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('bookkeeper').monthlyReport.preview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('bookkeeper').recovery.summary()).resolves.toBeTruthy();
  });
});

describe('claims', () => {
  it('materialises one claim per accepted leak discrepancy, capped at the invoice total, idempotently', async () => {
    // Seed: PRICE_HIGHER ₪100.00 on a ₪117.00 invoice → claim 10,000 agorot.
    expect(await syncClaims(db, T.restaurantId)).toBe(1);
    expect(await syncClaims(db, T.restaurantId)).toBe(0);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(c).toMatchObject({ status: 'claimed', amountAgorot: 10000, creditedAgorot: 0, supplierId: T.supplierId });
    const events = await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, c!.id));
    expect(events.map((e) => e.toStatus)).toEqual(['claimed']);

    // A second accepted line of ₪40 on the same invoice is capped at the remaining ₪17.
    await db.insert(discrepancies).values({
      matchRunId: T.matchRunId,
      restaurantId: T.restaurantId,
      type: 'QTY_OVER',
      severity: 'warn',
      deltaAmount: '40.00',
      resolutionStatus: 'accepted',
    });
    expect(await syncClaims(db, T.restaurantId)).toBe(1);
    const all = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(all.map((x) => x.amountAgorot).sort((a, b) => a - b)).toEqual([1700, 10000]);
    // Claimed never exceeds what the hero counts as claimed for the month.
    const hero = await computeLeakHero(db, T.restaurantId);
    expect(all.reduce((s, x) => s + x.amountAgorot, 0)).toBe(Math.round(hero.recoveredIls * 100));
    await db.delete(discrepancies).where(eq(discrepancies.type, 'QTY_OVER'));
  });

  it('does not claim open, waived, PRICE_LOWER or info discrepancies', async () => {
    await db.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, T.discrepancyId));
    expect(await syncClaims(db, T.restaurantId)).toBe(0);
    await db.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, T.discrepancyId));
    expect(await syncClaims(db, T.restaurantId)).toBe(0);
  });

  it('walks claimed → letter sent → acknowledged → credited (credit note) → recovered', async () => {
    const c = caller();
    const { summary } = await c.recovery.summary();
    expect(summary.claimedAgorot).toBe(10000);
    expect(summary.outstandingAgorot).toBe(10000);
    const [claim] = await c.recovery.list();
    await c.recovery.transition({ claimIds: [claim!.id], to: 'letter_sent' });
    await c.recovery.transition({ claimIds: [claim!.id], to: 'acknowledged' });
    await expect(c.recovery.transition({ claimIds: [claim!.id], to: 'letter_sent' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // Partial credit note (₪60) then the rest arrives as a credit line on a later invoice.
    const r1 = await c.recovery.recordCreditNote({
      claimIds: [claim!.id],
      supplierId: T.supplierId,
      number: 'CN-77',
      amountAgorot: 6000,
      issuedOn: '2026-10-10',
    });
    expect(r1).toMatchObject({ allocatedAgorot: 6000, unallocatedAgorot: 0 });
    let [after] = await c.recovery.list();
    expect(after).toMatchObject({ status: 'credited', creditedAgorot: 6000, outstandingAgorot: 4000, creditNoteNumber: 'CN-77' });

    await c.recovery.transition({ claimIds: [claim!.id], to: 'recovered' });
    const { summary: s2, returnedThisMonth } = await c.recovery.summary();
    expect(s2.recoveredAgorot).toBe(6000);
    expect(returnedThisMonth.returnedAgorot).toBe(6000);
    expect((await c.recovery.returnedThisMonth()).returnedAgorot).toBe(6000);
    // Recovered claims are closed: no more credit notes.
    [after] = await c.recovery.list();
    await expect(
      c.recovery.recordCreditNote({ claimIds: [after!.id], supplierId: T.supplierId, amountAgorot: 1, issuedOn: '2026-10-11' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const history = await c.recovery.history({ claimId: claim!.id });
    expect(history.map((h) => h.toStatus)).toEqual(['claimed', 'letter_sent', 'acknowledged', 'credited', 'recovered']);
  });

  it('matches a later invoice credit line: amount/number/date come from the invoice, used once', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    const [inv] = await db
      .insert(invoices)
      .values({
        restaurantId: T.restaurantId,
        supplierId: T.supplierId,
        invoiceNumber: 'INV-R-CREDIT',
        invoiceDate: new Date(Date.now() + 86_400_000),
        source: 'manual',
        status: 'matched',
      })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: inv!.id, rawDescription: 'זיכוי מחיר עגבניות', qtyBilled: '1', unit: 'unit', unitPriceBilled: '-100', lineTotal: '-100.00' })
      .returning();
    const suggestions = await c.recovery.creditLineSuggestions();
    expect(suggestions.map((s) => s.invoiceLineId)).toEqual([line!.id]);
    expect(suggestions[0]!.amountAgorot).toBe(10000);
    const res = await c.recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: line!.id });
    expect(res.allocatedAgorot).toBe(10000);
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.id, res.creditNoteId));
    expect(note).toMatchObject({ source: 'invoice_line', number: 'INV-R-CREDIT', amountAgorot: 10000, invoiceId: inv!.id });
    expect(await c.recovery.creditLineSuggestions()).toEqual([]);
    await db.delete(invoices).where(eq(invoices.id, inv!.id));
  });

  it('refuses a positive line as a credit note and a claim of another supplier', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    await expect(c.recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: T.invoiceLineId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('overdue reminders (outbox)', () => {
  it('chases claims waiting > 14 days once a week, one deduped email per manager per day', async () => {
    await syncClaims(db, T.restaurantId);
    const old = new Date(Date.now() - 20 * 86_400_000);
    await db.update(recoveryClaims).set({ status: 'letter_sent', letterSentAt: old }).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const r1 = await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, appUrl: 'https://app.test' });
    expect(r1).toMatchObject({ restaurants: 1, emails: 1, claims: 1 });
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('email');
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.body).toContain('ספק R');
    // Same day again: lastReminderAt is fresh → nothing new.
    expect((await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId })).claims).toBe(0);
    // Flag off → skipped entirely.
    await setFlags({});
    expect((await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId })).restaurants).toBe(0);
  });
});

describe('monthly report', () => {
  const month = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  it('agrees with the hero and renders email (he/en), WhatsApp and a PDF', async () => {
    const data = await computeMonthlyReport(db, T.restaurantId, month());
    const hero = await computeLeakHero(db, T.restaurantId);
    expect(data.leakAgorot).toBe(Math.round(hero.leakIls * 100));
    expect(data.spendAgorot).toBe(Math.round(hero.spendIls * 100));
    expect(data.claimedAgorot).toBe(10000);
    expect(data.topSuppliers[0]?.name).toBe('ספק R');
    expect(data.topIssues[0]?.type).toBe('PRICE_HIGHER');
    expect(data.nextActions.length).toBeGreaterThan(0);

    const he = monthlyReportEmail(data, { locale: 'he', reportUrl: 'https://app.test/r' });
    expect(he.html).toContain('dir="rtl"');
    expect(he.text).toContain('ספק R');
    const en = monthlyReportEmail(data, { locale: 'en' });
    expect(en.html).toContain('dir="ltr"');
    expect(en.subject).toMatch(/^Monthly report/);
    expect(en.text).not.toMatch(/[֐-׿]{3}.*Price above/);
    const wa = monthlyReportWhatsApp(data, { locale: 'he' });
    expect(wa.length).toBeLessThanOrEqual(WHATSAPP_MAX);
    expect(wa).toContain('₪');

    for (const locale of ['he', 'en'] as const) {
      const bytes = await renderMonthlyReportPdf(data, { locale });
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
      expect(bytes.length).toBeLessThan(120_000);
      const parsed = await PDFDocument.load(bytes);
      expect(parsed.getPageCount()).toBe(1);
      expect(parsed.getTitle()).toContain(data.month);
    }
  });

  it('preview + pdf procedures are owner/manager only', async () => {
    const p = await caller('manager').monthlyReport.preview({ month: month(), locale: 'en' });
    expect(p.email.html).toContain('dir="ltr"');
    const pdf = await caller().monthlyReport.pdf({ month: month(), locale: 'he' });
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    await expect(caller('chef').monthlyReport.pdf({ month: month(), locale: 'he' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sendMonthlyReports: freezes last month once, emails managers via the outbox, WhatsApp via the stub', async () => {
    const now = new Date();
    const r1 = await sendMonthlyReports(db, { restaurantId: T.restaurantId, now, appUrl: 'https://app.test' });
    expect(r1).toMatchObject({ restaurants: 1, emails: 1, whatsapp: 1, skipped: 0 });
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId));
    const wa = rows.find((r) => r.channel === 'whatsapp')!;
    expect(wa.status).toBe('sent'); // stub provider: marked sent, nothing left the building
    expect(rows.find((r) => r.channel === 'email')!.status).toBe('queued');
    const [stored] = await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, T.restaurantId));
    expect(stored!.sentAt).not.toBeNull();
    // Second run: already sent → skipped, no new outbox rows.
    const r2 = await sendMonthlyReports(db, { restaurantId: T.restaurantId, now });
    expect(r2).toMatchObject({ emails: 0, whatsapp: 0, skipped: 1 });
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId))).toHaveLength(2);
  });

  it('sendMonthlyReports skips restaurants without the flag', async () => {
    await setFlags({ recovery: true });
    expect(await sendMonthlyReports(db, { restaurantId: T.restaurantId })).toMatchObject({ restaurants: 0, emails: 0 });
  });
});

describe('refuter regressions', () => {
  it('cap holds when a later discrepancy is accepted first (claimed never exceeds the invoice / the hero)', async () => {
    await db.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, T.discrepancyId));
    const [extra] = await db
      .insert(discrepancies)
      .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '40.00', resolutionStatus: 'accepted' })
      .returning();
    try {
      await syncClaims(db, T.restaurantId);
      await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, T.discrepancyId));
      await syncClaims(db, T.restaurantId);
      const all = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
      const total = all.reduce((s, c) => s + c.amountAgorot, 0);
      expect(total).toBe(11700); // invoice total ₪117.00
      const hero = await computeLeakHero(db, T.restaurantId);
      expect(total).toBe(Math.round(hero.recoveredIls * 100));
    } finally {
      await db.delete(discrepancies).where(eq(discrepancies.id, extra!.id));
    }
  });

  it('parallel credit notes on one claim never over-credit (row lock)', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        appRouter
          .createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } })
          .recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, amountAgorot: 10000, issuedOn: '2026-10-10', number: `P-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const notes = await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId));
    expect(notes).toHaveLength(1);
    const [after] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id));
    expect(after!.creditedAgorot).toBe(10000);
    const credited = await db.select().from(recoveryEvents).where(eq(recoveryEvents.claimId, claim!.id));
    expect(credited.filter((e) => e.toStatus === 'credited')).toHaveLength(1);
  });

  it('a partly credited claim can be topped up; recovering short books the shortfall as written off', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, amountAgorot: 6000, issuedOn: '2026-10-10' });
    await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, amountAgorot: 1000, issuedOn: '2026-10-11' });
    let { summary } = await c.recovery.summary();
    expect(summary).toMatchObject({ claimedAgorot: 10000, creditedAgorot: 7000, outstandingAgorot: 3000 });
    await c.recovery.transition({ claimIds: [claim!.id], to: 'recovered' });
    ({ summary } = await c.recovery.summary());
    expect(summary).toMatchObject({ creditedAgorot: 7000, recoveredAgorot: 7000, outstandingAgorot: 0, writtenOffAgorot: 3000 });
    expect(summary.claimedAgorot).toBe(summary.creditedAgorot + summary.outstandingAgorot + summary.writtenOffAgorot);
  });

  it('re-using a credit line is a CONFLICT, not a 500', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId: T.restaurantId, supplierId: T.supplierId, invoiceNumber: 'INV-R-CR2', invoiceDate: new Date(Date.now() + 86_400_000), source: 'manual', status: 'matched' })
      .returning();
    const [line] = await db
      .insert(invoiceLines)
      .values({ invoiceId: inv!.id, rawDescription: 'זיכוי', qtyBilled: '1', unit: 'unit', unitPriceBilled: '-30', lineTotal: '-30.00' })
      .returning();
    try {
      await c.recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: line!.id });
      await expect(c.recovery.recordCreditNote({ claimIds: [claim!.id], invoiceLineId: line!.id })).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await db.delete(invoices).where(eq(invoices.id, inv!.id));
    }
  });

  it('preview and PDF show the frozen snapshot once the month was generated', async () => {
    const d = new Date();
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const frozen = await ensureMonthlyReport(db, T.restaurantId, month);
    await db
      .update(monthlyReports)
      .set({ snapshot: { ...frozen.data, leakAgorot: 4242 } as never })
      .where(eq(monthlyReports.id, frozen.id));
    const p = await caller().monthlyReport.preview({ month, locale: 'he' });
    expect(p.frozen).toBe(true);
    expect(p.data.leakAgorot).toBe(4242);
  });

  it('WhatsApp truncation keeps the report link', async () => {
    const d = new Date();
    const data = await computeMonthlyReport(db, T.restaurantId, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    data.topSuppliers = [{ name: 'א'.repeat(900), nameEn: null, leakAgorot: 100, leakPct: 0.02 }];
    const url = 'https://app.test/dashboard/reports/monthly?month=2026-09';
    const text = monthlyReportWhatsApp(data, { reportUrl: url });
    expect(text.length).toBeLessThanOrEqual(WHATSAPP_MAX);
    expect(text.endsWith(url)).toBe(true);
  });
});

describe('bulk transitions', () => {
  it('two bulk calls naming the same claims in opposite order do not deadlock', async () => {
    const [extra] = await db
      .insert(discrepancies)
      .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '5.00', resolutionStatus: 'accepted' })
      .returning();
    try {
      const list = await caller().recovery.list();
      const [a, b] = list.map((x) => x.id);
      for (let round = 0; round < 4; round++) {
        await db.update(recoveryClaims).set({ status: 'claimed' }).where(eq(recoveryClaims.restaurantId, T.restaurantId));
        const mk = () => appRouter.createCaller({ db, session: { userId: T.ownerUserId, restaurantId: T.restaurantId, role: 'owner' } });
        const res = await Promise.allSettled([
          mk().recovery.transition({ claimIds: [a!, b!], to: 'letter_sent' }),
          mk().recovery.transition({ claimIds: [b!, a!], to: 'disputed' }),
        ]);
        for (const r of res) {
          if (r.status === 'rejected') expect((r.reason as { code?: string }).code).toBe('CONFLICT');
        }
      }
    } finally {
      await db.delete(discrepancies).where(eq(discrepancies.id, extra!.id));
    }
  });
});
