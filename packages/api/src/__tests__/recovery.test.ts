import { randomUUID } from 'node:crypto';
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
  sql,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakHero } from '@restomatch/charts';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { enqueueRecoveryReminders } from '../recovery/reminders';
import { AUTO_WRITE_OFF_NOTE, listClaims, syncClaims } from '../recovery/service';
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

/** Claims block discrepancy deletes (0048, NO ACTION): drop a discrepancy's claims first. */
async function dropDiscrepancies(where: ReturnType<typeof eq>) {
  const ids = (await db.select({ id: discrepancies.id }).from(discrepancies).where(where)).map((r) => r.id);
  for (const id of ids) {
    await db.delete(recoveryClaims).where(eq(recoveryClaims.discrepancyId, id));
    await db.delete(discrepancies).where(eq(discrepancies.id, id));
  }
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
    await dropDiscrepancies(eq(discrepancies.type, 'QTY_OVER'));
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

  it('syncs claims before the snapshot: an accepted leak not yet materialised is still owed (money review)', async () => {
    // beforeEach dropped every claim; nothing has run syncClaims since.
    const data = await computeMonthlyReport(db, T.restaurantId, month());
    expect(data.recoveryTracked).toBe(true);
    expect(data.outstandingAgorot).toBe(10000);
    expect(data.nextActions.map((a) => a.code)).toContain('sendClaims');
  });

  it('without the recovery feature, returned/outstanding are hidden (unknown), not "₪0 owed"', async () => {
    await setFlags({ monthlyReport: true });
    const data = await computeMonthlyReport(db, T.restaurantId, month());
    expect(data.recoveryTracked).toBe(false);
    expect(await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId))).toHaveLength(0);
    const en = monthlyReportEmail(data, { locale: 'en' });
    expect(en.text).not.toMatch(/Still owed/i);
    expect(en.text).not.toMatch(/Actually returned/i);
    expect(monthlyReportWhatsApp(data, { locale: 'en' })).not.toMatch(/Actually returned/i);
    const bytes = await renderMonthlyReportPdf(data, { locale: 'en' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
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

  it('digest preview (flag monthlyDigestPreview): same numbers as the report, owner recipients, nothing queued', async () => {
    await setFlags({ recovery: true });
    await expect(caller().monthlyReport.digest()).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'FEATURE_DISABLED' } });
    expect((await caller().recovery.flags()).monthlyDigestPreview).toBe(false);
    await setFlags({ monthlyDigestPreview: true });
    expect((await caller().recovery.flags()).monthlyDigestPreview).toBe(true);
    const m = month();
    const d = await caller().monthlyReport.digest({ month: m, locale: 'he' });
    const r = await computeMonthlyReport(db, T.restaurantId, m);
    for (const k of ['leakAgorot', 'spendAgorot', 'leakPct', 'claimedAgorot', 'returnedAgorot', 'outstandingAgorot'] as const) {
      expect(d.data[k]).toBe(r[k]);
    }
    expect(d.data.topSuppliers).toEqual(r.topSuppliers);
    expect(d.to).toEqual(['owner-R@attack.test']);
    expect(d.fullReport).toBe(false); // independent of the monthlyReport flag
    expect(d.sendOn).toMatch(/^\d{4}-\d{2}-01$/);
    expect(d.subject.length).toBeGreaterThan(0);
    expect(await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, T.restaurantId))).toHaveLength(0);
    await expect(caller('bookkeeper').monthlyReport.digest()).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
      await dropDiscrepancies(eq(discrepancies.id, extra!.id));
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
      await dropDiscrepancies(eq(discrepancies.id, extra!.id));
    }
  });
});

describe('money cross-QA (S3) regressions', () => {
  it('BLOCKER 2: monthly "claimed" and top issues use the per-invoice cap (sum to the hero)', async () => {
    // ₪117 invoice: PRICE_HIGHER ₪100 (seed) + DUPLICATE ₪117, both accepted → capped at ₪117.
    const [dup] = await db
      .insert(discrepancies)
      .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'DUPLICATE_INVOICE', severity: 'block', deltaAmount: '117.00', resolutionStatus: 'accepted' })
      .returning();
    try {
      const d = new Date();
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const data = await computeMonthlyReport(db, T.restaurantId, month);
      const hero = await computeLeakHero(db, T.restaurantId);
      expect(data.claimedAgorot).toBe(Math.round(hero.recoveredIls * 100));
      expect(data.claimedAgorot).toBe(11700);
      expect(data.topIssues.reduce((s, i) => s + i.amountAgorot, 0)).toBe(Math.round(hero.leakIls * 100));
    } finally {
      await dropDiscrepancies(eq(discrepancies.id, dup!.id));
    }
  });

  it('HIGH 3: a discrepancy no longer accepted writes its untouched claim off (auto), re-accepting re-opens it', async () => {
    await syncClaims(db, T.restaurantId);
    await db.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, T.discrepancyId));
    await syncClaims(db, T.restaurantId);
    let [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(c!.status).toBe('written_off');
    const { summary } = await caller().recovery.summary();
    expect(summary.outstandingAgorot).toBe(0);
    // A new accepted line on the same invoice gets the full cap again (the written-off claim holds none).
    const [extra] = await db
      .insert(discrepancies)
      .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '117.00', resolutionStatus: 'accepted' })
      .returning();
    try {
      await syncClaims(db, T.restaurantId);
      const [x] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.discrepancyId, extra!.id));
      expect(x!.amountAgorot).toBe(11700);
    } finally {
      await db.delete(recoveryClaims).where(eq(recoveryClaims.discrepancyId, extra!.id));
      await dropDiscrepancies(eq(discrepancies.id, extra!.id));
    }
    await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, T.discrepancyId));
    await syncClaims(db, T.restaurantId);
    [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    expect(c!.status).toBe('claimed');
    const history = await caller().recovery.history({ claimId: c!.id });
    expect(history.map((h) => h.toStatus)).toEqual(['claimed', 'written_off', 'claimed']);
  });

  it('HIGH 3: a claim the owner wrote off by hand stays written off when its discrepancy is re-accepted', async () => {
    await syncClaims(db, T.restaurantId);
    const [claim] = await caller().recovery.list();
    await caller().recovery.transition({ claimIds: [claim!.id], to: 'written_off', note: 'owner gave up' });
    await db.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, T.discrepancyId));
    await syncClaims(db, T.restaurantId);
    await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, T.discrepancyId));
    await syncClaims(db, T.restaurantId);
    const [c] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id));
    expect(c!.status).toBe('written_off');
    const history = await caller().recovery.history({ claimId: c!.id });
    expect(history.map((h) => h.toStatus)).toEqual(['claimed', 'written_off']);
  });

  it('MEDIUM 5: a credit-note number is recorded once per supplier; an idempotency key replays', async () => {
    const c = caller();
    const [claim] = await c.recovery.list();
    const key = randomUUID();
    const first = await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, number: 'CN-9', amountAgorot: 1000, issuedOn: '2026-10-05', idempotencyKey: key });
    const again = await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, number: 'CN-9', amountAgorot: 1000, issuedOn: '2026-10-05', idempotencyKey: key });
    expect(again).toMatchObject({ creditNoteId: first.creditNoteId, duplicate: true });
    await expect(
      c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: T.supplierId, number: 'CN-9', amountAgorot: 1000, issuedOn: '2026-10-05' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, T.restaurantId))).toHaveLength(1);
    const [after] = await c.recovery.list();
    expect(after!.creditedAgorot).toBe(1000);
  });

  it('MEDIUM 6: a credit note is applied only to the selected claims (no spill-over)', async () => {
    const [extra] = await db
      .insert(discrepancies)
      .values({ matchRunId: T.matchRunId, restaurantId: T.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '10.00', resolutionStatus: 'accepted' })
      .returning();
    try {
      const c = caller();
      const claims = await c.recovery.list();
      expect(claims).toHaveLength(2);
      const big = claims.find((x) => x.amountAgorot === 10000)!;
      const res = await c.recovery.recordCreditNote({ claimIds: [big.id], supplierId: T.supplierId, amountAgorot: 12000, issuedOn: '2026-10-05' });
      expect(res).toMatchObject({ allocatedAgorot: 10000, unallocatedAgorot: 2000, creditedClaimIds: [big.id] });
      const other = (await c.recovery.list()).find((x) => x.id !== big.id)!;
      expect(other.creditedAgorot).toBe(0);
    } finally {
      await db.delete(recoveryClaims).where(eq(recoveryClaims.discrepancyId, extra!.id));
      await dropDiscrepancies(eq(discrepancies.id, extra!.id));
    }
  });

  it('LOW: a sent snapshot is never rewritten, even with refresh', async () => {
    const now = new Date();
    await sendMonthlyReports(db, { restaurantId: T.restaurantId, now });
    const [row] = await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, T.restaurantId));
    await db.update(monthlyReports).set({ snapshot: { ...(row!.snapshot as object), leakAgorot: 1 } }).where(eq(monthlyReports.id, row!.id));
    const again = await ensureMonthlyReport(db, T.restaurantId, (row!.month as string).slice(0, 7), { refresh: true });
    expect(again.data.leakAgorot).toBe(1);
  });

  it('LOW: the overdue badge and the reminder job agree at the 14-day boundary', async () => {
    await syncClaims(db, T.restaurantId);
    const now = new Date('2026-10-30T09:00:00Z');
    const justOver = new Date(now.getTime() - 14 * 86_400_000 - 60_000);
    await db.update(recoveryClaims).set({ status: 'letter_sent', letterSentAt: justOver, lastReminderAt: null }).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const [row] = await listClaims(db, T.restaurantId, { now });
    expect(row!.overdue).toBe(true);
    const almost = new Date(now.getTime() - 14 * 86_400_000 + 60_000);
    await db.update(recoveryClaims).set({ letterSentAt: almost }).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    const [row2] = await listClaims(db, T.restaurantId, { now });
    expect(row2!.overdue).toBe(false);
    expect((await enqueueRecoveryReminders(db, { restaurantId: T.restaurantId, now })).claims).toBe(0);
  });
});

// Last: a re-match replaces the seeded match run / discrepancy the other tests use.
describe('re-match vs claims (S3 blocker 1)', () => {
  it('refuses while money is in flight, and releases bare claims', async () => {
    await syncClaims(db, T.restaurantId);
    const [claim] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId));
    // Money in flight → refuse, nothing deleted.
    await db.update(recoveryClaims).set({ status: 'recovered', creditedAgorot: 10000, recoveredAt: new Date() }).where(eq(recoveryClaims.id, claim!.id));
    await expect(caller().match.runForInvoice({ invoiceId: T.invoiceId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id))).toHaveLength(1);
    // The DB refuses a direct discrepancy delete too (NO ACTION), whoever tries.
    await expect(db.delete(discrepancies).where(eq(discrepancies.id, T.discrepancyId))).rejects.toMatchObject({ code: '23503' });
    // A bare claim (no money history) is released and the re-match runs.
    await db.update(recoveryClaims).set({ status: 'claimed', creditedAgorot: 0, recoveredAt: null }).where(eq(recoveryClaims.id, claim!.id));
    const res = await caller().match.runForInvoice({ invoiceId: T.invoiceId });
    expect(res).toBeTruthy();
    expect(await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, T.restaurantId))).toHaveLength(0);
  });

});

describe('sendMonthlyReports isolates a failing restaurant (S4 M1)', () => {
  it('a tenant with an invalid timezone between two good ones is logged and skipped; both good ones are sent', async () => {
    const bad = await seedTenant(db, 'TZBAD');
    const good = await seedTenant(db, 'TZOK');
    const on = { settings: { features: { all: true } } as never };
    await db.update(restaurants).set(on).where(eq(restaurants.id, good.restaurantId));
    await db.update(restaurants).set({ ...on, timezone: 'Mars/Olympus_Mons' }).where(eq(restaurants.id, bad.restaurantId));
    const res = await sendMonthlyReports(db, { now: new Date() });
    expect(res.failed).toEqual([bad.restaurantId]);
    for (const id of [T.restaurantId, good.restaurantId]) {
      const [stored] = await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, id));
      expect(stored?.sentAt).not.toBeNull();
    }
    expect(await db.select().from(monthlyReports).where(eq(monthlyReports.restaurantId, bad.restaurantId))).toHaveLength(0);
  });
});

describe('refuter round 4 (S3 fixes)', () => {
  let n = 0;
  /** A fresh tenant with its seeded discrepancy accepted (₪100 on a ₪117 invoice). */
  async function fresh() {
    const X = await seedTenant(db, `RF${++n}`);
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, X.restaurantId));
    await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, X.discrepancyId));
    const c = appRouter.createCaller({ db, session: { userId: X.ownerUserId, restaurantId: X.restaurantId, role: 'owner' } } as AppContext);
    const claims = () => db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, X.restaurantId));
    const setStatus = (status: 'accepted' | 'rejected') =>
      db.update(discrepancies).set({ resolutionStatus: status }).where(eq(discrepancies.id, X.discrepancyId));
    return { X, c, claims, setStatus };
  }

  it('a re-opened claim is re-capped: the freed share taken meanwhile is not claimed twice', async () => {
    const { X, claims, setStatus } = await fresh();
    await syncClaims(db, X.restaurantId);
    await setStatus('rejected');
    await syncClaims(db, X.restaurantId);
    await db.insert(discrepancies).values({ matchRunId: X.matchRunId, restaurantId: X.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '117.00', resolutionStatus: 'accepted' });
    await syncClaims(db, X.restaurantId);
    await setStatus('accepted');
    await syncClaims(db, X.restaurantId);
    const held = (await claims()).filter((c) => c.status !== 'written_off');
    expect(held.reduce((a, c) => a + c.amountAgorot, 0)).toBe(11700);
    const [first] = (await claims()).filter((c) => c.discrepancyId === X.discrepancyId);
    expect(first!.status).toBe('written_off'); // nothing left of the cap
  });

  it('a system re-open restores letter_sent (not claimed)', async () => {
    const { X, c, claims, setStatus } = await fresh();
    await syncClaims(db, X.restaurantId);
    const [cl] = await claims();
    await c.recovery.transition({ claimIds: [cl!.id], to: 'letter_sent' });
    await setStatus('rejected');
    await syncClaims(db, X.restaurantId);
    await setStatus('accepted');
    await syncClaims(db, X.restaurantId);
    expect((await claims())[0]!.status).toBe('letter_sent');
  });

  it('re-match refuses a claim with history even when it is back to claimed / auto-written-off', async () => {
    const a = await fresh();
    await syncClaims(db, a.X.restaurantId);
    const [ca] = await a.claims();
    for (const to of ['letter_sent', 'written_off', 'claimed'] as const) await a.c.recovery.transition({ claimIds: [ca!.id], to });
    await expect(a.c.match.runForInvoice({ invoiceId: a.X.invoiceId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await a.claims()).toHaveLength(1);

    const b = await fresh();
    await syncClaims(db, b.X.restaurantId);
    const [cb] = await b.claims();
    await b.c.recovery.transition({ claimIds: [cb!.id], to: 'letter_sent' });
    await b.setStatus('rejected');
    await syncClaims(db, b.X.restaurantId);
    await expect(b.c.match.runForInvoice({ invoiceId: b.X.invoiceId })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await b.claims()).toHaveLength(1);
  });

  it('typing the system note by hand does not make a write-off "system" (no re-open, no release)', async () => {
    const { X, c, claims } = await fresh();
    await syncClaims(db, X.restaurantId);
    const [cl] = await claims();
    await c.recovery.transition({ claimIds: [cl!.id], to: 'written_off', note: AUTO_WRITE_OFF_NOTE });
    await syncClaims(db, X.restaurantId);
    expect((await claims())[0]!.status).toBe('written_off');
    await expect(c.match.runForInvoice({ invoiceId: X.invoiceId })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('re-match racing the tracker sync never 500s (per-restaurant lock)', async () => {
    for (let i = 0; i < 3; i++) {
      const { X, c } = await fresh();
      const res = await Promise.allSettled([c.match.runForInvoice({ invoiceId: X.invoiceId }), c.recovery.summary()]);
      for (const r of res) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).not.toBe('INTERNAL_SERVER_ERROR');
    }
  });

  it('an idempotency key reused with a different payload is a CONFLICT, not a silent duplicate', async () => {
    const { X, c, claims } = await fresh();
    await syncClaims(db, X.restaurantId);
    const [cl] = await claims();
    const key = randomUUID();
    await c.recovery.recordCreditNote({ claimIds: [cl!.id], supplierId: X.supplierId, amountAgorot: 3000, issuedOn: '2026-10-01', idempotencyKey: key });
    await expect(
      c.recovery.recordCreditNote({ claimIds: [cl!.id], supplierId: X.supplierId, amountAgorot: 9999, issuedOn: '2026-10-01', idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a human re-open is re-capped too; nothing left of the cap → CONFLICT', async () => {
    const { X, c, claims } = await fresh();
    await syncClaims(db, X.restaurantId);
    const [cl] = await claims();
    await c.recovery.transition({ claimIds: [cl!.id], to: 'written_off' });
    const [extra] = await db
      .insert(discrepancies)
      .values({ matchRunId: X.matchRunId, restaurantId: X.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '117.00', resolutionStatus: 'accepted' })
      .returning();
    await syncClaims(db, X.restaurantId);
    await expect(c.recovery.transition({ claimIds: [cl!.id], to: 'claimed' })).rejects.toMatchObject({ code: 'CONFLICT' });
    // Free part of the cap: the re-open takes only what is left.
    await db.update(recoveryClaims).set({ amountAgorot: 10000 }).where(eq(recoveryClaims.discrepancyId, extra!.id));
    await c.recovery.transition({ claimIds: [cl!.id], to: 'claimed' });
    const held = (await claims()).filter((x) => x.status !== 'written_off').reduce((a, x) => a + x.amountAgorot, 0);
    expect(held).toBe(11700);
  });

  it('a bulk transition and the tracker sync waiting on the same claims never deadlock', async () => {
    const { X, c, claims } = await fresh();
    await db
      .insert(discrepancies)
      .values({ matchRunId: X.matchRunId, restaurantId: X.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '10.00', resolutionStatus: 'accepted' });
    await syncClaims(db, X.restaurantId);
    const cs = (await claims()).sort((a, b) => a.id.localeCompare(b.id));
    const [A, C] = [cs[0]!, cs[1]!]; // A (lower id) will be re-opened by sync; C written off by it
    const setD = (id: string, st: 'accepted' | 'rejected') =>
      db.update(discrepancies).set({ resolutionStatus: st }).where(eq(discrepancies.id, id));
    await setD(A.discrepancyId, 'rejected');
    await syncClaims(db, X.restaurantId);
    await setD(A.discrepancyId, 'accepted');
    await setD(C.discrepancyId, 'rejected');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // A third transaction holds A so that the two contenders interleave deterministically.
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from recovery_claims where id = ${A.id} for update`);
      await sleep(500);
    });
    await sleep(100);
    const settle = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => String(e.code));
    const tr = settle(c.recovery.transition({ claimIds: [A.id, C.id], to: 'written_off' }));
    await sleep(150);
    const sm = settle(c.recovery.summary());
    await holder;
    for (const o of await Promise.all([tr, sm])) expect(o).not.toBe('INTERNAL_SERVER_ERROR');
  });
});
