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
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { computeLeakHero } from '@restomatch/charts';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { syncClaims } from '../recovery/service';
import { computeMonthlyReport, monthlyReportEmail, monthlyReportWhatsApp, previousMonthKey } from '../reports/monthly';
import { renderMonthlyReportPdf } from '../reports/pdf';
import { visualOrder } from '../reports/bidi';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B])
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, t.restaurantId));
});

beforeEach(async () => {
  for (const t of [A, B]) {
    await db.delete(recoveryClaims).where(eq(recoveryClaims.restaurantId, t.restaurantId));
    await db.delete(creditNotes).where(eq(creditNotes.restaurantId, t.restaurantId));
    await db.delete(monthlyReports).where(eq(monthlyReports.restaurantId, t.restaurantId));
    await db.delete(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, t.restaurantId));
    await db.update(discrepancies).set({ resolutionStatus: 'accepted', resolvedAt: new Date() }).where(eq(discrepancies.id, t.discrepancyId));
  }
});

afterAll(async () => {
  await resetDb(db);
});

describe('refuter', () => {
  it('OVER-CAP: accepting discrepancies out of creation order claims more than the invoice total', async () => {
    // D1 (seed, ₪100, created first) is still open; D2 (₪40, created later) accepted first.
    await db.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, A.discrepancyId));
    const [d2] = await db
      .insert(discrepancies)
      .values({ matchRunId: A.matchRunId, restaurantId: A.restaurantId, type: 'QTY_OVER', severity: 'warn', deltaAmount: '40.00', resolutionStatus: 'accepted' })
      .returning();
    await syncClaims(db, A.restaurantId);
    await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, A.discrepancyId));
    await syncClaims(db, A.restaurantId);
    const claims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.restaurantId, A.restaurantId));
    const total = claims.reduce((s, c) => s + c.amountAgorot, 0);
    const hero = await computeLeakHero(db, A.restaurantId);
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, A.invoiceId));
    console.log('OVERCAP claims', claims.map((c) => c.amountAgorot), 'sum', total, 'hero.recovered', hero.recoveredIls, 'invoice total', inv!.totalInclVat);
    await db.delete(discrepancies).where(eq(discrepancies.id, d2!.id));
    expect(total).toBe(Math.round(hero.recoveredIls * 100));
  });

  it('RACE: two concurrent credit notes on the same claim both "allocate" in full', async () => {
    await syncClaims(db, A.restaurantId);
    const [claim] = await caller(A).recovery.list();
    const mk = (n: string) =>
      caller(A).recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: A.supplierId, number: n, amountAgorot: claim!.amountAgorot, issuedOn: '2026-10-10' });
    const res = await Promise.allSettled([mk('X1'), mk('X2')]);
    console.log('RACE', res.map((r) => (r.status === 'fulfilled' ? r.value : String((r as PromiseRejectedResult).reason))));
    const notes = await db.select().from(creditNotes).where(eq(creditNotes.restaurantId, A.restaurantId));
    const [after] = await db.select().from(recoveryClaims).where(eq(recoveryClaims.id, claim!.id));
    const allocated = res.reduce((s, r) => s + (r.status === 'fulfilled' ? r.value.allocatedAgorot : 0), 0);
    console.log('RACE notes', notes.length, 'allocated sum', allocated, 'claim credited', after!.creditedAgorot, 'amount', after!.amountAgorot);
    expect(allocated).toBeLessThanOrEqual(after!.amountAgorot);
  });

  it('PARTIAL: partially credited claim cannot take a second note; recovered drops the shortfall', async () => {
    await syncClaims(db, A.restaurantId);
    const c = caller(A);
    const [claim] = await c.recovery.list();
    await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: A.supplierId, amountAgorot: 6000, issuedOn: '2026-10-10' });
    const second = await c.recovery
      .recordCreditNote({ claimIds: [claim!.id], supplierId: A.supplierId, amountAgorot: 4000, issuedOn: '2026-10-11' })
      .catch((e: unknown) => (e as Error).message);
    console.log('PARTIAL second note:', second);
    await c.recovery.transition({ claimIds: [claim!.id], to: 'recovered' });
    const { summary } = await c.recovery.summary();
    console.log('PARTIAL summary', { claimed: summary.claimedAgorot, credited: summary.creditedAgorot, outstanding: summary.outstandingAgorot, writtenOff: summary.writtenOffAgorot, rate: summary.recoveryRate });
  });

  it('CREDIT LINE REUSE: second use of the same line -> error code', async () => {
    await db.insert(discrepancies).values({ matchRunId: A.matchRunId, restaurantId: A.restaurantId, type: 'QTY_SHORT', severity: 'warn', deltaAmount: '5.00', resolutionStatus: 'accepted' });
    await syncClaims(db, A.restaurantId);
    const c = caller(A);
    const claims = await c.recovery.list();
    const [inv] = await db.insert(invoices).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, invoiceNumber: 'CR', invoiceDate: new Date(Date.now() + 86400000), source: 'manual', status: 'matched' }).returning();
    const [line] = await db.insert(invoiceLines).values({ invoiceId: inv!.id, rawDescription: 'זיכוי', qtyBilled: '1', unit: 'unit', unitPriceBilled: '-1', lineTotal: '-1.00' }).returning();
    await c.recovery.recordCreditNote({ claimIds: [claims[0]!.id], invoiceLineId: line!.id });
    const err = await c.recovery.recordCreditNote({ claimIds: [claims[1]!.id], invoiceLineId: line!.id }).catch((e: { code?: string; message?: string }) => `${e.code} ${e.message?.slice(0, 120)}`);
    console.log('REUSE second use ->', err);
    // B cannot use A's line or claims
    const errB = await caller(B).recovery.recordCreditNote({ claimIds: [claims[0]!.id], invoiceLineId: line!.id }).catch((e: { code?: string }) => e.code);
    const errB2 = await caller(B).recovery.history({ claimId: claims[0]!.id }).catch((e: { code?: string }) => e.code);
    const listB = await caller(B).recovery.list({ supplierId: A.supplierId });
    const sugB = await caller(B).recovery.creditLineSuggestions({ supplierId: A.supplierId });
    const trB = await caller(B).recovery.transition({ claimIds: [claims[0]!.id], to: 'written_off' }).catch((e: { code?: string }) => e.code);
    console.log('TENANT B', errB, errB2, listB.length, sugB.length, trB);
    await db.delete(invoices).where(eq(invoices.id, inv!.id));
    await db.delete(discrepancies).where(eq(discrepancies.type, 'QTY_SHORT'));
  });

  it('ROLES: receiver/chef on every recovery + report proc', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      const c = caller(A, role);
      const out: Record<string, string> = {};
      const tries: Record<string, () => Promise<unknown>> = {
        summary: () => c.recovery.summary(),
        list: () => c.recovery.list(),
        sugg: () => c.recovery.creditLineSuggestions(),
        returned: () => c.recovery.returnedThisMonth(),
        preview: () => c.monthlyReport.preview(),
        pdf: () => c.monthlyReport.pdf({ month: '2026-09', locale: 'he' }),
      };
      for (const [k, f] of Object.entries(tries)) out[k] = await f().then(() => 'OK', (e: { code?: string }) => String(e.code));
      console.log('ROLE', role, out);
    }
  });

  it('LIFECYCLE: write off → reopen → credit; credited → disputed → written_off; dispute partial', async () => {
    await syncClaims(db, A.restaurantId);
    const c = caller(A);
    const [claim] = await c.recovery.list();
    await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: A.supplierId, amountAgorot: 3000, issuedOn: '2026-10-10' });
    await c.recovery.transition({ claimIds: [claim!.id], to: 'disputed' });
    await c.recovery.transition({ claimIds: [claim!.id], to: 'written_off' });
    let s = (await c.recovery.summary()).summary;
    console.log('LC written_off after partial credit', { credited: s.creditedAgorot, writtenOff: s.writtenOffAgorot, outstanding: s.outstandingAgorot, rate: s.recoveryRate });
    await c.recovery.transition({ claimIds: [claim!.id], to: 'claimed' });
    await c.recovery.recordCreditNote({ claimIds: [claim!.id], supplierId: A.supplierId, amountAgorot: 99999, issuedOn: '2026-10-10' }).then((r) => console.log('LC reopen+credit', r));
    const [after] = await c.recovery.list();
    console.log('LC final', after!.status, after!.creditedAgorot, after!.amountAgorot);
    const recoveredWithout = await c.recovery.transition({ claimIds: [claim!.id], to: 'recovered' }).then(() => 'OK', (e: { code?: string }) => e.code);
    console.log('LC recovered', recoveredWithout);
  });

  it('REPORT: month keys, xss escaping, whatsapp len, pdf exotic chars', async () => {
    console.log('PMK', previousMonthKey(new Date('2026-10-31T22:30:00Z')), previousMonthKey(new Date('2026-11-01T05:00:00Z')), previousMonthKey(new Date('2027-01-01T00:30:00+02:00')));
    await db.update(suppliers).set({ name: '<script>alert(1)</script>"&' + 'א'.repeat(300), nameEn: '<img src=x onerror=alert(1)>' }).where(eq(suppliers.id, A.supplierId));
    const now = new Date();
    const month = previousMonthKey(new Date(now.getTime() + 40 * 86400000));
    const data = await computeMonthlyReport(db, A.restaurantId, month);
    console.log('REPORT month', month, 'top', data.topSuppliers.length, data.nextActions.map((a) => a.code));
    for (const locale of ['he', 'en'] as const) {
      const e = monthlyReportEmail(data, { locale, reportUrl: 'https://app.test/dashboard/reports/monthly?month=' + month });
      console.log('XSS', locale, /<script|<img/.test(e.html), /<script|<img/.test(e.subject));
      const wa = monthlyReportWhatsApp(data, { locale, reportUrl: 'https://app.test/dashboard/reports/monthly?month=' + month });
      console.log('WA', locale, wa.length, 'url intact?', wa.includes('month=' + month));
    }
    await db.update(suppliers).set({ name: 'Поставщик 😀 ﭏ ع', nameEn: null }).where(eq(suppliers.id, A.supplierId));
    const d2 = await computeMonthlyReport(db, A.restaurantId, month);
    const pdf = await renderMonthlyReportPdf(d2, { locale: 'he' }).then((b) => `ok ${b.length}`, (e: Error) => `THROW ${e.message}`);
    console.log('PDF exotic', pdf);
    console.log('BIDI', JSON.stringify(visualOrder('ספק Tnuva (בע"מ) — ‏1,234 ‏₪ · 1.6%', 'rtl')), JSON.stringify(visualOrder('חשבונית INV-12/3 מ-2026-10-01', 'rtl')), JSON.stringify(visualOrder('-5 ₪ זיכוי', 'rtl')));
    await db.update(suppliers).set({ name: 'ספק A', nameEn: null }).where(eq(suppliers.id, A.supplierId));
  });
});
