import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, testDbUrl, type Database } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * W2-03 × G-15b: payRun.markPaid applies the owner pay-approval rule (₪5,000+ incl. VAT, or a
 * new supplier ⇒ owner only) to every invoice that still has to pass approve_for_payment.
 * Only while PAY_RUN_MARK_PAID is on; the flag-off order (NOT_FOUND → PRECONDITION_FAILED →
 * NOT_IMPLEMENTED) is pinned in payrun.attack.test.ts and is unchanged.
 */

const db: Database = createDb(testDbUrl());
let A: Tenant;
const prevFlag = process.env.PAY_RUN_MARK_PAID;

type InvStatus = (typeof invoices.$inferInsert)['status'];
async function invoice(totalInclVat: string, status: InvStatus) {
  const [row] = await db
    .insert(invoices)
    .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, totalInclVat, status, source: 'manual' })
    .returning({ id: invoices.id, status: invoices.status });
  return { invoiceId: row!.id, expectedStatus: row!.status };
}
function markPaid(role: Session['role'], item: { invoiceId: string; expectedStatus: InvStatus }) {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } };
  return appRouter
    .createCaller(ctx)
    .payRun.markPaid({ items: [item as never], paidOn: '2026-11-20', method: 'bank_transfer', clientMutationId: `cmid-og-${crypto.randomUUID()}` });
}

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
});
beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'OG');
  await db
    .update(restaurants)
    .set({ settings: { features: { payRun: true } } as (typeof restaurants.$inferInsert)['settings'] })
    .where(eq(restaurants.id, A.restaurantId));
  // Known supplier: one earlier PAID invoice, so only the amount rule is in play below.
  await invoice('100.00', 'paid');
  process.env.PAY_RUN_MARK_PAID = '1';
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env.PAY_RUN_MARK_PAID;
  else process.env.PAY_RUN_MARK_PAID = prevFlag;
});
afterAll(async () => {
  await resetDb(db);
});

describe('payRun.markPaid × owner pay-approval (G-15b)', () => {
  it('a manager on a matched ₪5,000.00 invoice ⇒ FORBIDDEN payment.ownerApprovalRequired', async () => {
    const item = await invoice('5000.00', 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'payment.ownerApprovalRequired' },
    });
  });

  it('a bookkeeper on a disputed ₪7,500.00 invoice ⇒ FORBIDDEN as well', async () => {
    const item = await invoice('7500.00', 'disputed');
    await expect(markPaid('bookkeeper', item)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the owner passes the gate (and reaches the not-yet-wired write)', async () => {
    const item = await invoice('5000.00', 'matched');
    await expect(markPaid('owner', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('a manager under the threshold passes the gate', async () => {
    const item = await invoice('4999.99', 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('an already-approved invoice skips the gate (it never passes approve_for_payment again)', async () => {
    const item = await invoice('9000.00', 'approved');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('flag off ⇒ NOT_IMPLEMENTED before the gate, even for a manager on ₪5,000+', async () => {
    delete process.env.PAY_RUN_MARK_PAID;
    const item = await invoice('5000.00', 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidOff' });
  });
});
