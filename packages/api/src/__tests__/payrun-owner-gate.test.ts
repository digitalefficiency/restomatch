import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoiceLines, invoices, matchRuns, restaurants, suppliers, testDbUrl, type Database } from '@restomatch/db';
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
async function invoice(
  totalInclVat: string | null,
  status: InvStatus,
  supplierId = A.supplierId,
  ocrTotal?: number,
) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: A.restaurantId,
      supplierId,
      totalInclVat,
      status,
      source: 'manual',
      ...(ocrTotal !== undefined
        ? { ocrPayload: { provider: 'reconciled' as const, raw: { reconciled: { totals: { total: ocrTotal } } } } }
        : {}),
    })
    .returning({ id: invoices.id, status: invoices.status });
  return { invoiceId: row!.id, expectedStatus: row!.status };
}
async function newSupplier(name: string) {
  const [s] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name }).returning({ id: suppliers.id });
  return s!.id;
}
async function markLiveDuplicate(invoiceId: string) {
  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: A.restaurantId, invoiceId, overallStatus: 'blocked', totalDiscrepancyAmount: '0' })
    .returning();
  await db.insert(discrepancies).values({
    matchRunId: mr!.id,
    restaurantId: A.restaurantId,
    type: 'DUPLICATE_INVOICE',
    severity: 'block',
    resolutionStatus: 'open',
    deltaAmount: '0',
  });
}
function markPaid(role: Session['role'], item: { invoiceId: string; expectedStatus: InvStatus }, ackFirstPayment = false) {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role } };
  return appRouter
    .createCaller(ctx)
    .payRun.markPaid({
      items: [item as never],
      paidOn: '2026-11-20',
      method: 'bank_transfer',
      // A never-paid supplier first trips AU-14's soft `first_payment` warning (it runs before this gate).
      ...(ackFirstPayment ? { acknowledgedFlags: [{ invoiceId: item.invoiceId, kinds: ['first_payment' as const] }] } : {}),
      clientMutationId: `cmid-og-${crypto.randomUUID()}`,
    });
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

  it('an already-approved invoice is gated again (fail closed — review of #380)', async () => {
    const item = await invoice('9000.00', 'approved');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('an unknown total (header NULL, no OCR total, no lines) ⇒ owner only (fail closed)', async () => {
    const item = await invoice(null, 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('a header lowered below ₪5,000 under an OCR-read ₪12,000 ⇒ still owner only (the higher figure counts)', async () => {
    const item = await invoice('4999.00', 'matched', A.supplierId, 12000);
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a header lowered below Σ lines incl. VAT ⇒ still owner only', async () => {
    const item = await invoice('4999.00', 'matched');
    await db.insert(invoiceLines).values({
      invoiceId: item.invoiceId,
      rawDescription: 'שמן זית',
      qtyBilled: '100',
      unit: 'יח',
      unitPriceBilled: '50',
      lineTotal: '5000.00',
      vatRate: '0.18',
    });
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a total raised after approval (₪4,000 approved → ₪40,000) ⇒ re-gated, owner only', async () => {
    const item = await invoice('4000.00', 'approved');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
    await db.update(invoices).set({ totalInclVat: '40000.00' }).where(eq(invoices.id, item.invoiceId));
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it("a 'parsed' invoice is gated too: ₪5,000+ and new-supplier ⇒ bookkeeper FORBIDDEN", async () => {
    const big = await invoice('5000.00', 'parsed');
    await expect(markPaid('bookkeeper', big)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sid = await newSupplier('ספק חדש לגמרי');
    const fresh = await invoice('100.00', 'parsed', sid);
    await expect(markPaid('bookkeeper', fresh, true)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('the refusal carries the code only — no amount, threshold or reason', async () => {
    const item = await invoice('5000.00', 'matched');
    const e = await markPaid('manager', item).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'FORBIDDEN', message: 'payment.ownerApprovalRequired' });
    expect((e as { cause: { appParams?: unknown } }).cause.appParams).toBeUndefined();
  });

  it('new supplier (owner 11.11): earlier UNPAID invoices are no history ⇒ owner only, even under ₪5,000', async () => {
    const sid = await newSupplier('ספק חדש');
    await invoice('300.00', 'approved', sid);
    await invoice('200.00', 'matched', sid);
    const item = await invoice('120.00', 'matched', sid);
    await expect(markPaid('manager', item, true)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('new supplier: a PAID duplicate copy is no history; one real paid invoice is', async () => {
    const sid = await newSupplier('ספק עם עותק');
    const copy = await invoice('300.00', 'paid', sid);
    await markLiveDuplicate(copy.invoiceId);
    const item = await invoice('120.00', 'matched', sid);
    await expect(markPaid('manager', item, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await invoice('300.00', 'paid', sid);
    await expect(markPaid('manager', item, true)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('flag off ⇒ NOT_IMPLEMENTED before the gate, even for a manager on ₪5,000+', async () => {
    delete process.env.PAY_RUN_MARK_PAID;
    const item = await invoice('5000.00', 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidOff' });
  });
});
