import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { lockReceipt } from '@restomatch/api';
import { ocrMayAutoMatch } from '../jobs/ocrInvoice';
import { matchInvoiceForJob } from '../jobs/matchInvoice';

const db = createDb(testDbUrl());
const other = createDb(testDbUrl()); // a second connection: the "submit in flight"
let restaurantId = '';
let supplierId = '';
let poId = '';
let grId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
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
  const [r] = await db.insert(restaurants).values({ name: 'Receipt-lock test' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'HaSharon' }).returning();
  supplierId = s!.id;
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  poId = po!.id;
  const [pl] = await db
    .insert(poLines)
    .values({ poId, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
    .returning();
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId, status: 'pending' }).returning();
  grId = gr!.id;
  await db.insert(grLines).values({ grId, poLineId: pl!.id, qtyReceived: '10' });
});

afterAll(cleanup);

describe('OCR auto-match vs an in-flight receipt submit (F2: receipt lock)', () => {
  it('holds while the receipt is open; matches once it is closed', async () => {
    expect(await ocrMayAutoMatch(db, restaurantId, grId)).toBe(false);
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
    expect(await ocrMayAutoMatch(db, restaurantId, grId)).toBe(true);
  });

  it('a check during an uncommitted submit WAITS for it, then sees the receipt closed (no lost invoice)', async () => {
    let check: Promise<boolean> | undefined;
    let settled = false;
    await other.transaction(async (tx) => {
      await lockReceipt(tx as unknown as Database, grId); // submitReceipt takes it first
      await tx.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
      check = ocrMayAutoMatch(db, restaurantId, grId);
      check.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false); // blocked on the receipt lock, not reading "pending"
    });
    expect(await check!).toBe(true); // → the OCR job matches the invoice itself
  });

  it('a scan with no receipt matches at once; a failing check matches now (logged)', async () => {
    expect(await ocrMayAutoMatch(db, restaurantId, undefined)).toBe(true);
    const broken = { transaction: () => Promise.reject(new Error('db down')) } as unknown as Database;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await ocrMayAutoMatch(broken, restaurantId, grId)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('match job: a receipt submit never rewrites a signed-off invoice (F4)', () => {
  it('rematch on an approved/paid invoice with a run is skipped and the run is kept', async () => {
    for (const status of ['approved', 'paid'] as const) {
      const [inv] = await db.insert(invoices).values({ restaurantId, supplierId, status, source: 'photo' }).returning();
      await db.insert(invoiceLines).values({
        invoiceId: inv!.id,
        rawDescription: 'עגבניה',
        qtyBilled: '10',
        unit: 'kg',
        unitPriceBilled: '8',
        lineTotal: '80',
      });
      const [run] = await db
        .insert(matchRuns)
        .values({ restaurantId, invoiceId: inv!.id, poId, overallStatus: 'clean' })
        .returning();
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv!.id, rematch: true, poId });
      expect(out.skipped).toBe('settled');
      const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, inv!.id));
      expect(runs.map((r) => r.id)).toEqual([run!.id]);
    }
  });
});
