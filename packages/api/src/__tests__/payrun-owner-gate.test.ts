import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoiceLines, invoices, matchRuns, memberships, purchaseOrders, restaurants, suppliers, testDbUrl, users, type Database } from '@restomatch/db';
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
/** A real manager of A (so audit rows carry a non-owner user). */
async function managerUser() {
  const [u] = await db.insert(users).values({ email: `mgr-${crypto.randomUUID()}@test.local`, name: 'מנהלת' }).returning({ id: users.id });
  await db.insert(memberships).values({ userId: u!.id, restaurantId: A.restaurantId, role: 'manager' });
  return u!.id;
}
function asManager(userId: string) {
  const ctx: AppContext = { db, session: { userId, restaurantId: A.restaurantId, role: 'manager' } };
  return appRouter.createCaller(ctx);
}
async function line(invoiceId: string, lineTotal: string, vatRate: string | null = null) {
  const [l] = await db
    .insert(invoiceLines)
    .values({ invoiceId, rawDescription: 'שמן זית', qtyBilled: '1', unit: 'יח', unitPriceBilled: lineTotal, lineTotal, vatRate })
    .returning({ id: invoiceLines.id });
  return l!.id;
}
function markPaid(
  role: Session['role'],
  item: { invoiceId: string; expectedStatus: InvStatus },
  ack: boolean | Array<'first_payment' | 'possible_duplicate'> = false,
  userId = A.ownerUserId,
) {
  const kinds = ack === true ? (['first_payment'] as const) : ack === false ? [] : ack;
  const ctx: AppContext = { db, session: { userId, restaurantId: A.restaurantId, role } };
  return appRouter
    .createCaller(ctx)
    .payRun.markPaid({
      items: [item as never],
      paidOn: '2026-11-20',
      method: 'bank_transfer',
      // A soft AU-14 warning (first_payment, possible_duplicate) runs before this gate: acknowledge it.
      ...(kinds.length ? { acknowledgedFlags: [{ invoiceId: item.invoiceId, kinds: [...kinds] }] } : {}),
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

  // ── review 2 of #380: no OCR document total ──
  it('P1: no OCR total, a manager lowers a hand line ⇒ owner only (figures changed by a non-owner)', async () => {
    const mgr = await managerUser();
    const item = await invoice('5900.00', 'matched');
    const l = await line(item.invoiceId, '5000.00');
    await asManager(mgr).receiving.updateInvoiceLine({ lineId: l, patch: { lineTotal: 100, unitPriceBilled: 100 } });
    await db.update(invoices).set({ totalInclVat: '118.00' }).where(eq(invoices.id, item.invoiceId));
    await expect(markPaid('manager', item, ['possible_duplicate'], mgr)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('P2: no OCR total, a manager lowers a printed line and the header ⇒ owner only', async () => {
    const mgr = await managerUser();
    const item = await invoice('5900.00', 'matched');
    const l = await line(item.invoiceId, '5000.00');
    await asManager(mgr).receiving.updateInvoiceLine({ lineId: l, patch: { lineTotal: 100, unitPriceBilled: 100 } });
    await asManager(mgr).receiving.updateInvoiceHeader({ invoiceId: item.invoiceId, patch: { totalExclVat: 100, vatAmount: 18, totalInclVat: 118 } });
    await expect(markPaid('manager', item, ['possible_duplicate'], mgr)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('…the same edits by the OWNER leave the figures trusted (₪118 ⇒ a manager may mark it)', async () => {
    const item = await invoice('5900.00', 'matched');
    const l = await line(item.invoiceId, '5000.00');
    const owner = appRouter.createCaller({ db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } });
    await owner.receiving.updateInvoiceLine({ lineId: l, patch: { lineTotal: 100, unitPriceBilled: 100 } });
    await owner.receiving.updateInvoiceHeader({ invoiceId: item.invoiceId, patch: { totalExclVat: 100, vatAmount: 18, totalInclVat: 118 } });
    await expect(markPaid('manager', item, ['possible_duplicate'])).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('P6: header NULL, no OCR total, Σ lines ₪100 ⇒ owner only (lines alone are never the basis)', async () => {
    const item = await invoice(null, 'matched');
    await line(item.invoiceId, '84.75', '0.18');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN', cause: { appCode: 'payment.ownerApprovalRequired' } });
  });

  it('P6b: header NULL, a ₪0.00 line ⇒ owner only', async () => {
    const item = await invoice(null, 'matched');
    await line(item.invoiceId, '0.00');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("Σ lines use the header's VAT chain: a VAT-exempt supplier's ₪4,300.00 stays under ₪5,000 ⇒ a manager may mark it", async () => {
    await db.update(suppliers).set({ vatRate: '0' }).where(eq(suppliers.id, A.supplierId));
    const item = await invoice('4300.00', 'matched');
    await line(item.invoiceId, '4300.00');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it("…and the PO's rate wins over the supplier's (latest match run)", async () => {
    const item = await invoice('4300.00', 'matched');
    await line(item.invoiceId, '4300.00');
    const [po] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'closed', source: 'manual', vatRate: '0' })
      .returning({ id: purchaseOrders.id });
    await db.insert(matchRuns).values({ restaurantId: A.restaurantId, invoiceId: item.invoiceId, poId: po!.id, overallStatus: 'clean', totalDiscrepancyAmount: '0' });
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidAwaitsH03' });
  });

  it('flag off ⇒ NOT_IMPLEMENTED before the gate, even for a manager on ₪5,000+', async () => {
    delete process.env.PAY_RUN_MARK_PAID;
    const item = await invoice('5000.00', 'matched');
    await expect(markPaid('manager', item)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', message: 'payRun.markPaidOff' });
  });
});
