import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, matchRuns, restaurants, testDbUrl, type Database } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { jerusalemDayKey } from '../lib/dueDate';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * The home row "ריצת התשלומים של החודש" (payRun.month → totals.payIls) and the pay-run page it
 * links to (payRun.list → totals.payableIls) must agree: an invoice with VAT at risk (no
 * allocation number above the threshold) is held on BOTH, never "ניתן לשלם" on one only.
 * (main e2e W1-05:277, MF-24950 — train-C #321 gap.)
 */

const db: Database = createDb(testDbUrl());
let A: Tenant;
const TODAY = jerusalemDayKey(new Date())!;

async function invoice(v: { exVat: string; vat: string; alloc: string | null; number: string }) {
  const incl = (Number(v.exVat) + Number(v.vat)).toFixed(2);
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      invoiceNumber: v.number,
      // Today, Israeli noon — inside the current month on any day of it.
      invoiceDate: new Date(`${TODAY}T12:00:00+02:00`),
      totalExclVat: v.exVat,
      vatAmount: v.vat,
      totalInclVat: incl,
      allocationNumber: v.alloc,
      status: 'matched',
      source: 'photo',
    })
    .returning({ id: invoices.id });
  // Checked = it has a match run (INVOICE_CHECKED); a clean one, no findings.
  await db.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: row!.id, overallStatus: 'clean', totalDiscrepancyAmount: '0' });
  return row!.id;
}
function caller() {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } };
  return appRouter.createCaller(ctx);
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

describe('payRun.month × vatAtRisk (missing allocation number)', () => {
  it('an at-risk invoice in the month is held in month(); home payIls == list payableIls', async () => {
    const atRisk = await invoice({ exVat: '6240.00', vat: '1123.20', alloc: null, number: 'MF-24950' });
    await invoice({ exVat: '1000.00', vat: '180.00', alloc: null, number: 'OK-1' }); // under the threshold
    const c = caller();

    const month = await c.payRun.month();
    const list = await c.payRun.list({ monthOffset: 0 });

    const inv = month.suppliers.flatMap((s) => s.invoices).find((i) => i.invoiceId === atRisk);
    expect(inv?.status).toBe('hold');
    expect(list.rows.find((r) => r.invoiceId === atRisk)?.selectable).toBe(false);
    expect(month.totals.payIls).toBe(1180);
    expect(month.totals.payIls).toBe(list.totals.payableIls);
    // The seeded tenant has its own held invoice; MF-24950's ₪7,363.20 is now among the held.
    expect(month.totals.holdIls).toBeGreaterThanOrEqual(7363.2);
  });

  it('with the allocation number in place it is payable on both again', async () => {
    await invoice({ exVat: '6240.00', vat: '1123.20', alloc: '123456789', number: 'MF-24951' });
    const c = caller();
    const month = await c.payRun.month();
    const list = await c.payRun.list({ monthOffset: 0 });
    expect(month.totals.payIls).toBe(7363.2);
    expect(month.totals.payIls).toBe(list.totals.payableIls);
  });
});
