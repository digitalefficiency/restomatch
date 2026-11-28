import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoices,
  matchRuns,
  restaurants,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { assertCanApproveForPayment, payApprovalFor } from '../approvals/payApproval';
import { effectiveSettings } from '../routers/settings';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-15b: the pay-approval gate (owner 11.11: Q2 incl. VAT, Q3 setting, Q4 new
 * supplier = no previously PAID invoices, duplicates don't count).
 */

const db: Database = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

type InvStatus = (typeof invoices.$inferInsert)['status'];
async function invoice(t: Tenant, totalInclVat: string, status: InvStatus, supplierId = t.supplierId) {
  const [row] = await db
    .insert(invoices)
    .values({ restaurantId: t.restaurantId, supplierId, totalInclVat, status, source: 'manual' })
    .returning({ id: invoices.id });
  return row!.id;
}
async function markLiveDuplicate(t: Tenant, invoiceId: string) {
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: t.restaurantId, invoiceId, overallStatus: 'blocked', totalDiscrepancyAmount: '0' })
    .returning();
  await db.insert(discrepancies).values({
    matchRunId: mr!.id,
    restaurantId: t.restaurantId,
    type: 'DUPLICATE_INVOICE',
    severity: 'block',
    resolutionStatus: 'open',
    deltaAmount: '0',
  });
}
async function newSupplier(t: Tenant, name: string) {
  const [s] = await db.insert(suppliers).values({ restaurantId: t.restaurantId, name }).returning({ id: suppliers.id });
  return s!.id;
}
const as = (t: Tenant, role: 'owner' | 'manager' | 'bookkeeper') => ({ restaurantId: t.restaurantId, role });

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
});
beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'PAY-A');
  B = await seedTenant(db, 'PAY-B');
});
afterAll(async () => {
  await resetDb(db);
  // Close the pool: CI's Postgres has a small connection cap.
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('pay approval: amount (₪5,000 and above, incl. VAT)', () => {
  it('known supplier, ₪4,999.99 → a manager may approve', async () => {
    await invoice(A, '1200.00', 'paid');
    const inv = await invoice(A, '4999.99', 'matched');
    await expect(assertCanApproveForPayment(db, as(A, 'manager'), inv)).resolves.toMatchObject({ requiresOwner: false });
  });

  it('known supplier, exactly ₪5,000.00 → owner only (FORBIDDEN payment.ownerApprovalRequired for a manager)', async () => {
    await invoice(A, '1200.00', 'paid');
    const inv = await invoice(A, '5000.00', 'matched');
    await expect(assertCanApproveForPayment(db, as(A, 'manager'), inv)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'payment.ownerApprovalRequired', appParams: { reasons: 'over_amount', amount: 5000, threshold: 5000 } },
    });
    await expect(assertCanApproveForPayment(db, as(A, 'owner'), inv)).resolves.toMatchObject({
      requiresOwner: true,
      reasons: ['over_amount'],
    });
  });

  it('the threshold is read from settings.approvalThresholds.payApprovalOverAmount', async () => {
    await invoice(A, '1200.00', 'paid');
    const inv = await invoice(A, '6000.00', 'matched');
    await db
      .update(restaurants)
      .set({ settings: { approvalThresholds: { payApprovalOverAmount: 8000 } } as (typeof restaurants.$inferInsert)['settings'] })
      .where(eq(restaurants.id, A.restaurantId));
    await expect(assertCanApproveForPayment(db, as(A, 'manager'), inv)).resolves.toMatchObject({ requiresOwner: false });
  });
});

describe('pay approval: new supplier (Q4 = no previously PAID invoice; duplicates do not count)', () => {
  it('a supplier whose earlier invoices are only unpaid → new → owner only, whatever the amount', async () => {
    const sid = await newSupplier(A, 'ספק חדש');
    await invoice(A, '300.00', 'matched', sid); // earlier, but not paid
    await invoice(A, '300.00', 'approved', sid); // approved, still not paid
    const inv = await invoice(A, '120.00', 'matched', sid);
    const d = await payApprovalFor(db, A.restaurantId, inv);
    expect(d).toMatchObject({ requiresOwner: true, reasons: ['new_supplier'], inputs: { supplierPriorInvoices: 0 } });
    await expect(assertCanApproveForPayment(db, as(A, 'manager'), inv)).rejects.toMatchObject({
      cause: { appCode: 'payment.ownerApprovalRequired', appParams: { reasons: 'new_supplier' } },
    });
  });

  it("a PAID duplicate copy does not count as history; a real paid invoice does", async () => {
    const sid = await newSupplier(A, 'ספק עם כפולה');
    const dup = await invoice(A, '300.00', 'paid', sid);
    await markLiveDuplicate(A, dup);
    const inv = await invoice(A, '120.00', 'matched', sid);
    expect(await payApprovalFor(db, A.restaurantId, inv)).toMatchObject({ requiresOwner: true, reasons: ['new_supplier'] });
    await invoice(A, '300.00', 'paid', sid); // a real paid invoice
    expect(await payApprovalFor(db, A.restaurantId, inv)).toMatchObject({ requiresOwner: false, reasons: [] });
  });

  it('a duplicate rejected as "not a duplicate" is real history again', async () => {
    const sid = await newSupplier(A, 'ספק נדחה');
    const was = await invoice(A, '300.00', 'paid', sid);
    await markLiveDuplicate(A, was);
    await db.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.restaurantId, A.restaurantId));
    const inv = await invoice(A, '120.00', 'matched', sid);
    expect(await payApprovalFor(db, A.restaurantId, inv)).toMatchObject({ requiresOwner: false });
  });

  it('the invoice itself never counts as its own history', async () => {
    const sid = await newSupplier(A, 'ספק לבד');
    const inv = await invoice(A, '120.00', 'paid', sid);
    expect(await payApprovalFor(db, A.restaurantId, inv)).toMatchObject({ inputs: { supplierPriorInvoices: 0 } });
  });

  it('both reasons together', async () => {
    const sid = await newSupplier(A, 'ספק גדול');
    const inv = await invoice(A, '9000.00', 'matched', sid);
    await expect(assertCanApproveForPayment(db, as(A, 'manager'), inv)).rejects.toMatchObject({
      cause: { appParams: { reasons: 'over_amount,new_supplier' } },
    });
  });
});

describe('pay approval: tenant scope', () => {
  it("B's invoice is NOT_FOUND for A, and B's paid history never counts for A's supplier", async () => {
    const bInv = await invoice(B, '100.00', 'matched');
    await expect(assertCanApproveForPayment(db, as(A, 'owner'), bInv)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // B has paid invoices; A's same-tag supplier has none → still new for A.
    await invoice(B, '100.00', 'paid');
    const aInv = await invoice(A, '100.00', 'matched');
    expect(await payApprovalFor(db, A.restaurantId, aInv)).toMatchObject({ reasons: ['new_supplier'] });
  });
});

describe('settings: effective payApprovalOverAmount', () => {
  it('default ₪5,000 (isDefault), override read back', () => {
    expect(effectiveSettings({}).approvalThresholds.payApprovalOverAmount).toEqual({ value: 5000, isDefault: true });
    const s = { approvalThresholds: { payApprovalOverAmount: 8000 } } as Parameters<typeof effectiveSettings>[0];
    expect(effectiveSettings(s).approvalThresholds.payApprovalOverAmount).toEqual({ value: 8000, isDefault: false });
  });
});
