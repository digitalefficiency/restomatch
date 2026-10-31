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
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { lockReceipt } from '@restomatch/api';
import { ocrAutoMatchDecision, ocrMayAutoMatch } from '../jobs/ocrInvoice';
import { matchInvoiceForJob } from '../jobs/matchInvoice';

const db = createDb(testDbUrl());
const other = createDb(testDbUrl()); // a second connection: the "submit in flight"
let restaurantId = '';
let supplierId = '';
let poId = '';
let grId = '';
// G-08: lines carry a product (an order's name-only line is an open question that holds a first match).
let productId = '';

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
  await db.delete(products).where(eq(products.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'Receipt-lock test' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'HaSharon' }).returning();
  supplierId = s!.id;
  const [prod] = await db.insert(products).values({ restaurantId, supplierId, canonicalName: 'עגבניה', defaultUnit: 'kg' }).returning();
  productId = prod!.id;
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  poId = po!.id;
  const [pl] = await db
    .insert(poLines)
    .values({ poId, productId, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
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

describe('a photo scan whose job lost its receipt (OCR sweep retry of a lost enqueue)', () => {
  async function scan(source: 'photo' | 'email') {
    const [inv] = await db.insert(invoices).values({ restaurantId, supplierId, status: 'matched', source }).returning();
    return inv!.id;
  }

  it("is held while its supplier's receipt opened before it is being counted; e-mail / WhatsApp scans are not", async () => {
    const photo = await scan('photo');
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo })).toEqual({ match: false });
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: await scan('email') })).toEqual({ match: true });
    // No scan given (callers that know there is no receipt): unchanged.
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined)).toEqual({ match: true });
  });

  it('a receipt opened after the scan, older than 24 h, closed, or of another supplier does not hold it', async () => {
    const photo = await scan('photo');
    await db.update(goodsReceipts).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(goodsReceipts.id, grId));
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo })).toEqual({ match: true });
    await db.update(goodsReceipts).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(goodsReceipts.id, grId));
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo })).toEqual({ match: true });
    await db.update(goodsReceipts).set({ createdAt: new Date(Date.now() - 3600_000), status: 'completed' }).where(eq(goodsReceipts.id, grId));
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo })).toEqual({ match: true });
    await db.update(goodsReceipts).set({ status: 'pending' }).where(eq(goodsReceipts.id, grId));
    const [other] = await db.insert(suppliers).values({ restaurantId, name: 'Galilee' }).returning();
    await db.update(invoices).set({ supplierId: other!.id }).where(eq(invoices.id, photo));
    expect(await ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo })).toEqual({ match: true });
  });

  it('a submit in flight is waited for; the receipt that just closed pins the match to its PO', async () => {
    const photo = await scan('photo');
    let check: Promise<{ match: boolean; poId?: string }> | undefined;
    let settled = false;
    await other.transaction(async (tx) => {
      await lockReceipt(tx as unknown as Database, grId);
      await tx.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
      check = ocrAutoMatchDecision(db, restaurantId, undefined, { invoiceId: photo });
      check.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false); // blocked on the receipt lock
    });
    expect(await check!).toEqual({ match: true, poId });
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

async function heldScan() {
  const [inv] = await db.insert(invoices).values({ restaurantId, supplierId, status: 'matched', source: 'photo' }).returning();
  await db.insert(invoiceLines).values({
    invoiceId: inv!.id,
    productId,
    rawDescription: 'עגבניה',
    qtyBilled: '10',
    unit: 'kg',
    unitPriceBilled: '8',
    lineTotal: '80',
  });
  return inv!.id;
}
const runsOf = (invoiceId: string) =>
  db.select({ poId: matchRuns.poId, grId: matchRuns.grId }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));

describe('match job: the payload is not a trust boundary (verifier MAJOR, defence in depth)', () => {
  it('never matches against a receipt still being counted (receipt_open), even when told to', async () => {
    const inv = await heldScan(); // its receipt (grId) is pending
    for (const data of [{}, { rematch: true }, { rematch: true, poId }]) {
      const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, ...data });
      expect(out.skipped).toBe('receipt_open');
    }
    expect(await runsOf(inv)).toEqual([]);
  });

  it('a job poId is binding: another supplier’s PO is refused (po_rejected), no fallback to discovery', async () => {
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
    const inv = await heldScan();
    const [gal] = await db.insert(suppliers).values({ restaurantId, name: 'Galilee' }).returning();
    const [galPo] = await db
      .insert(purchaseOrders)
      .values({ restaurantId, supplierId: gal!.id, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
      .returning();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, rematch: true, poId: galPo!.id });
    warn.mockRestore();
    expect(out.skipped).toBe('po_rejected');
    expect(await runsOf(inv)).toEqual([]);
  });
});

describe('sibling PO (verifier MINOR 1 + 2): PO1 counted this morning, PO2 being counted now', () => {
  async function siblingSetup() {
    const morning = new Date();
    morning.setHours(Math.max(0, morning.getHours() - 3));
    const [po1] = await db
      .insert(purchaseOrders)
      .values({ restaurantId, supplierId, expectedDeliveryAt: morning, status: 'sent', source: 'manual' })
      .returning();
    const [pl1] = await db
      .insert(poLines)
      .values({ poId: po1!.id, productId, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8' })
      .returning();
    const [gr1] = await db.insert(goodsReceipts).values({ restaurantId, poId: po1!.id, status: 'completed' }).returning();
    await db.insert(grLines).values({ grId: gr1!.id, poLineId: pl1!.id, qtyReceived: '10' });
    return { po1: po1!.id, gr1: gr1!.id };
  }

  it('OCR after the submit: the decision carries GR2’s PO, and the match lands on PO2/GR2 — exactly one run', async () => {
    await siblingSetup();
    const inv = await heldScan();
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId)); // submitted first
    const decision = await ocrAutoMatchDecision(db, restaurantId, grId);
    expect(decision).toEqual({ match: true, poId });
    await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, ...(decision.poId ? { poId: decision.poId } : {}) });
    expect(await runsOf(inv)).toEqual([{ poId, grId }]);
  });

  it('OCR before the submit: held, then the submit’s rematch (pinned to PO2) lands on PO2/GR2 — exactly one run', async () => {
    await siblingSetup();
    const inv = await heldScan();
    expect(await ocrAutoMatchDecision(db, restaurantId, grId)).toEqual({ match: false });
    await db.update(goodsReceipts).set({ status: 'completed' }).where(eq(goodsReceipts.id, grId));
    await matchInvoiceForJob(db, { restaurantId, invoiceId: inv, rematch: true, poId });
    expect(await runsOf(inv)).toEqual([{ poId, grId }]);
  });
});
