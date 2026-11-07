import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, goodsReceipts, grLines, invoices, poLines, purchaseOrders, restaurants, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { monthWindow } from '../routers/close';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-05a `close.checklist`: the month-close figures that have no other home —
 * unchecked invoices, pending consolidated invoices, delivery notes no invoice
 * covers. Tenant-scoped (another restaurant's rows never count).
 */

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const MONTH = '2026-09';

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: t.ownerUserId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function invoice(
  t: Tenant,
  v: { day: string; incl: string | null; status: 'ocr_pending' | 'parsed' | 'matched' | 'approved'; consolidated?: boolean },
) {
  const [row] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: `C-${Math.random().toString(36).slice(2, 10)}`,
      invoiceDate: new Date(`${v.day}T10:00:00+03:00`),
      totalInclVat: v.incl,
      status: v.status,
      source: 'photo',
      ...(v.consolidated ? { ocrPayload: { raw: { kind: 'consolidated' } } as never } : {}),
    })
    .returning({ id: invoices.id });
  return row!.id;
}

/** A delivery note on its own PO (one receipt per PO), ₪8.50 per unit, no invoice. */
async function note(t: Tenant, day: string, qty: string) {
  const at = new Date(`${day}T08:00:00+03:00`);
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, expectedDeliveryAt: at, status: 'sent', source: 'manual' })
    .returning({ id: purchaseOrders.id });
  const [line] = await db
    .insert(poLines)
    .values({ poId: po!.id, rawDescription: 'עגבניות', qtyOrdered: qty, unit: 'kg', unitPriceExpected: '8.5' })
    .returning({ id: poLines.id });
  const [gr] = await db
    .insert(goodsReceipts)
    .values({
      restaurantId: t.restaurantId,
      poId: po!.id,
      receivedBy: t.ownerUserId,
      status: 'completed',
      receivedAt: at,
    })
    .returning({ id: goodsReceipts.id });
  await db.insert(grLines).values({ grId: gr!.id, poLineId: line!.id, qtyReceived: qty, qtyRejected: '0' });
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

afterAll(async () => {
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.();
});

describe('close.checklist (DB)', () => {
  it('counts the month’s unchecked invoices incl. VAT, agora-exact; checked and other months stay out', async () => {
    await invoice(A, { day: '2026-09-03', incl: '117.10', status: 'ocr_pending' });
    await invoice(A, { day: '2026-09-30', incl: '0.20', status: 'parsed' });
    await invoice(A, { day: '2026-09-12', incl: null, status: 'ocr_pending' }); // not read yet: counted, ₪0
    await invoice(A, { day: '2026-09-15', incl: '999.00', status: 'matched' });
    await invoice(A, { day: '2026-10-01', incl: '50.00', status: 'parsed' }); // October (Israel time)
    await invoice(B, { day: '2026-09-05', incl: '777.00', status: 'parsed' }); // other tenant

    const r = await callerFor(A, 'bookkeeper').close.checklist({ month: MONTH });
    expect(r.month).toBe(MONTH);
    expect(r.unchecked).toEqual({ count: 3, amountIls: 117.3 });
  });

  it('pending consolidated invoices are their own step (never double-counted as unchecked); settled ones drop out', async () => {
    const first = await invoice(A, { day: '2026-09-02', incl: '1000.00', status: 'parsed', consolidated: true });
    await invoice(A, { day: '2026-09-20', incl: '250.50', status: 'ocr_pending', consolidated: true });
    await invoice(A, { day: '2026-09-21', incl: '400.00', status: 'approved', consolidated: true });
    await invoice(B, { day: '2026-09-02', incl: '1.00', status: 'parsed', consolidated: true });

    const r = await callerFor(A).close.checklist({ month: MONTH });
    expect(r.consolidated).toEqual({ count: 2, amountIls: 1250.5, firstInvoiceId: first });
    expect(r.unchecked.count).toBe(0);
  });

  it('delivery notes no invoice covers: null while the ledger flag is off, else the reused coverage rule', async () => {
    await note(A, '2026-09-10', '4'); // 4 × ₪8.50 (PO price) = ₪34
    await note(B, '2026-09-10', '9');
    expect((await callerFor(A).close.checklist({ month: MONTH })).deliveryNotes).toBeNull();

    await db
      .update(restaurants)
      .set({ settings: { features: { supplierLedger: true } } as never })
      .where(eq(restaurants.id, A.restaurantId));
    const r = await callerFor(A).close.checklist({ month: MONTH });
    expect(r.deliveryNotes).toEqual({ count: 1, amountIls: 34 });
  });

  it('an empty month is all zeros (the page shows it calm, never as an alarm)', async () => {
    const r = await callerFor(A).close.checklist({ month: '2026-06' });
    expect(r.unchecked).toEqual({ count: 0, amountIls: 0 });
    expect(r.consolidated).toEqual({ count: 0, amountIls: 0, firstInvoiceId: null });
  });

  it('receiver and chef are refused (no purchase ₪)', async () => {
    await expect(callerFor(A, 'receiver').close.checklist({ month: MONTH })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A, 'chef').close.checklist({ month: MONTH })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a malformed month', async () => {
    await expect(callerFor(A).close.checklist({ month: '2026-13' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('monthWindow', () => {
  it('is the month on the Israel wall clock (summer and winter offsets)', () => {
    const { start, end } = monthWindow('2026-10', 'Asia/Jerusalem');
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // IDT (+3)
    expect(end.toISOString()).toBe('2026-10-31T22:00:00.000Z'); // IST (+2)
    expect(monthWindow('2026-12', 'Asia/Jerusalem').end.toISOString()).toBe('2026-12-31T22:00:00.000Z');
  });
});
