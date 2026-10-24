import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { shouldAutoMatch } from '../jobs/ocrInvoice';
import { isStillInOcr } from '../jobs/matchInvoice';
import { findJobInvoice } from '../jobs/findJobInvoice';

const db = createDb(testDbUrl());
let restaurantId = '';
let supplierId = '';
let grId = '';

async function cleanup() {
  if (!restaurantId) return;
  const invs = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId));
  for (const i of invs) await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, i.id));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  const grs = await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  for (const g of grs) await db.delete(grLines).where(eq(grLines.grId, g.id));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  const pos = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId));
  for (const p of pos) await db.delete(poLines).where(eq(poLines.poId, p.id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'OCR auto-match trigger test' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'HaSharon' }).returning();
  supplierId = s!.id;
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  const [pl] = await db
    .insert(poLines)
    .values({ poId: po!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
    .returning();
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId: po!.id, status: 'pending' }).returning();
  grId = gr!.id;
  // Photo registered BEFORE counting: the receipt line exists but nothing is counted yet.
  await db.insert(grLines).values({ grId, poLineId: pl!.id, qtyReceived: '0' });
});

afterAll(cleanup);

async function ocrdInvoice(forSupplier = supplierId) {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId, supplierId: forSupplier, status: 'matched', source: 'photo' })
    .returning();
  await db.insert(invoiceLines).values({
    invoiceId: inv!.id,
    rawDescription: 'עגבניה',
    qtyBilled: '10',
    unit: 'kg',
    unitPriceBilled: '8',
    lineTotal: '80',
  });
  return inv!.id;
}

describe('OCR job: shouldAutoMatch', () => {
  it('does NOT match while the invoice’s receipt is still being counted (no false "received 0" leak)', async () => {
    const inv = await ocrdInvoice();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await shouldAutoMatch(db, restaurantId, inv, false)).toBe(false);
    log.mockRestore();
  });

  it('matches once the receipt is submitted (the OCR-finishes-after-submit race)', async () => {
    const inv = await ocrdInvoice();
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
    expect(await shouldAutoMatch(db, restaurantId, inv, false)).toBe(true);
    await db.update(goodsReceipts).set({ status: 'partial' }).where(eq(goodsReceipts.id, grId));
    expect(await shouldAutoMatch(db, restaurantId, inv, false)).toBe(true);
  });

  it('an invoice with no receipt (email / WhatsApp / upload) still matches straight away', async () => {
    const [other] = await db.insert(suppliers).values({ restaurantId, name: 'No PO supplier' }).returning();
    const inv = await ocrdInvoice(other!.id);
    expect(await shouldAutoMatch(db, restaurantId, inv, false)).toBe(true);
  });

  it('never when OCR needs a human', async () => {
    const inv = await ocrdInvoice();
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
    expect(await shouldAutoMatch(db, restaurantId, inv, true)).toBe(false);
  });

  it('if the receipt check itself fails, matches now (previous behaviour) and logs', async () => {
    const broken = { transaction: () => Promise.reject(new Error('db down')) } as unknown as Database;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await shouldAutoMatch(broken, restaurantId, 'x', false)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('match job: an invoice still in OCR is a no-op', () => {
  it('findJobInvoice carries the status and isStillInOcr flags ocr_pending only', async () => {
    const [pending] = await db
      .insert(invoices)
      .values({ restaurantId, supplierId, status: 'ocr_pending', source: 'photo' })
      .returning();
    const row = await findJobInvoice(db, restaurantId, pending!.id, []);
    expect(row?.status).toBe('ocr_pending');
    expect(isStillInOcr(row!)).toBe(true);
    for (const status of ['parsed', 'matched', 'approved']) expect(isStillInOcr({ status })).toBe(false);
  });
});
