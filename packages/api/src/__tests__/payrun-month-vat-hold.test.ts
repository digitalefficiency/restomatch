import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices, matchRuns, restaurants, testDbUrl, type Database } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { invoiceStatesOf } from '../invoices';
import { jerusalemDayKey } from '../lib/dueDate';
import { payRunTasks } from '../tasks/sources';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * The home row "ריצת התשלומים של החודש" and the pay-run page it OPENS must show the same ₪:
 *  · the row links to `/dashboard/approvals/pay-run?m=0`, i.e. payRun.list({ monthOffset: 0 });
 *  · its ₪ = payRun.month totals.payableIls = list's selectable Σ (pay + claim, net of holds);
 *  · an invoice with VAT at risk (no allocation number above the threshold) is held on both.
 * (main e2e W1-05:277 — MF-24950 — and review of #384.)
 */

const db: Database = createDb(testDbUrl());
let A: Tenant;
const TODAY = jerusalemDayKey(new Date())!;
/** A day of the previous IL month (5 days before this month's 1st). */
const LAST_MONTH = (() => {
  const d = new Date(`${TODAY.slice(0, 8)}01T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 5);
  return d.toISOString().slice(0, 10);
})();

async function invoice(v: {
  exVat: string;
  vat: string;
  alloc?: string | null;
  number: string;
  day?: string;
  acceptedDelta?: string;
}) {
  const incl = (Number(v.exVat) + Number(v.vat)).toFixed(2);
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: v.number,
      // Israeli noon of the day (default today — inside the current month on any day of it).
      invoiceDate: new Date(`${v.day ?? TODAY}T12:00:00+02:00`),
      totalExclVat: v.exVat,
      vatAmount: v.vat,
      totalInclVat: incl,
      allocationNumber: v.alloc === undefined ? '123456789' : v.alloc,
      status: 'matched',
      source: 'photo',
    })
    .returning({ id: invoices.id });
  // Checked = it has a match run (INVOICE_CHECKED).
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: A.restaurantId, invoiceId: row!.id, overallStatus: v.acceptedDelta ? 'minor' : 'clean', totalDiscrepancyAmount: v.acceptedDelta ?? '0' })
    .returning({ id: matchRuns.id });
  if (v.acceptedDelta) {
    // An accepted real finding: a credit is still asked for (status 'claim'), the payment is not stopped.
    await db.insert(discrepancies).values({
      matchRunId: mr!.id,
      restaurantId: A.restaurantId,
      type: 'PRICE_HIGHER',
      severity: 'warn',
      resolutionStatus: 'accepted',
      deltaAmount: v.acceptedDelta,
    });
  }
  return row!.id;
}
function caller() {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
}
/** The home row, and the list call its link opens. */
async function homeAndPage() {
  const c = caller();
  const month = await c.payRun.month();
  const [task] = payRunTasks(month);
  expect(task?.deepLink ?? '/dashboard/approvals/pay-run?m=0').toBe('/dashboard/approvals/pay-run?m=0');
  const page = await c.payRun.list({ monthOffset: 0 }); // what `?m=0` renders (pay-run/page.tsx)
  return { month, task, page };
}

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'MV');
  await db
    .update(restaurants)
    .set({ settings: { features: { payRun: true } } as (typeof restaurants.$inferInsert)['settings'] })
    .where(eq(restaurants.id, A.restaurantId));
});
afterAll(async () => {
  await resetDb(db);
});

describe('home "ריצת התשלומים של החודש" == the pay-run page it opens', () => {
  it('VAT at risk: held in month() and on the page; home ₪ == page payable', async () => {
    const atRisk = await invoice({ exVat: '6240.00', vat: '1123.20', alloc: null, number: 'MF-24950' });
    await invoice({ exVat: '1000.00', vat: '180.00', alloc: null, number: 'OK-1' }); // under the threshold
    const { month, task, page } = await homeAndPage();

    const inv = month.suppliers.flatMap((s) => s.invoices).find((i) => i.invoiceId === atRisk);
    expect(inv?.status).toBe('hold');
    expect(page.rows.find((r) => r.invoiceId === atRisk)?.selectable).toBe(false);
    expect(month.totals.payableIls).toBe(1180);
    expect(month.totals.payableIls).toBe(page.totals.payableIls);
    expect(task?.ilsAgorot).toBe(Math.round(page.totals.payableIls * 100));
    expect(task?.count).toBe(page.totals.payableCount);
    // The seeded tenant has its own held invoice; MF-24950's ₪7,363.20 is now among the held.
    expect(month.totals.holdIls).toBeGreaterThanOrEqual(7363.2);

    // Invoice-state parity exception (invoices/state.ts): the state is 'clean', the bucket 'hold'.
    const states = await invoiceStatesOf(db, A.restaurantId, [atRisk]);
    expect(states.get(atRisk)?.state).toBe('clean');
  });

  it('a claim invoice (accepted Δ₪50) is payable on the page, so it is in the home ₪ too', async () => {
    const claim = await invoice({ exVat: '1000.00', vat: '180.00', number: 'CL-1', acceptedDelta: '50.00' });
    const { month, task, page } = await homeAndPage();
    expect(month.suppliers.flatMap((s) => s.invoices).find((i) => i.invoiceId === claim)?.status).toBe('claim');
    expect(page.rows.find((r) => r.invoiceId === claim)?.selectable).toBe(true);
    expect(month.totals.payableIls).toBe(1180);
    expect(month.totals.payableIls).toBe(page.totals.payableIls);
    expect(task?.ilsAgorot).toBe(118000);
  });

  it("last month's unpaid invoice is not in THIS month's row, and the row opens the month page, not the full desk", async () => {
    await invoice({ exVat: '2000.00', vat: '360.00', number: 'LM-1', day: LAST_MONTH });
    await invoice({ exVat: '1000.00', vat: '180.00', number: 'TM-1' });
    const { month, task, page } = await homeAndPage();
    expect(month.totals.payableIls).toBe(1180);
    expect(page.totals.payableIls).toBe(1180);
    expect(task?.ilsAgorot).toBe(118000);
    // The unfiltered desk (bare link) would show both — that is a different page.
    expect((await caller().payRun.list()).totals.payableIls).toBe(3540);
  });

  it('with the allocation number in place it is payable on both again', async () => {
    await invoice({ exVat: '6240.00', vat: '1123.20', alloc: '123456789', number: 'MF-24951' });
    const { month, task, page } = await homeAndPage();
    expect(month.totals.payableIls).toBe(7363.2);
    expect(month.totals.payableIls).toBe(page.totals.payableIls);
    expect(task?.ilsAgorot).toBe(736320);
  });
});
