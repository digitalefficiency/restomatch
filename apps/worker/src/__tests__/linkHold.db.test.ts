import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discrepancies,
  eq,
  invoiceLines,
  invoices,
  matchRuns,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { matchInvoiceForJob } from '../jobs/matchInvoice';

/**
 * G-08 hold, second review (31.10):
 *   H-1  the release decision runs in the match-invoice job, after every answer
 *        committed — two concurrent answers can no longer strand an invoice;
 *   M-4  a first match waits while its order has unlinked name-only lines;
 *   LOW  an answer undone while the job runs never leaves a run over an unlinked line.
 */
const db = createDb(testDbUrl());
let restaurantId = '';
let supplierId = '';
let P = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'G-08 hold' }).returning();
  restaurantId = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ירקות הגליל' }).returning();
  supplierId = s!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId, supplierId, canonicalName: 'פלפל אדום', defaultUnit: 'ק״ג' })
    .returning();
  P = p!.id;
  await db.insert(supplierCatalogItems).values({ restaurantId, supplierId, productId: P, supplierNameRaw: 'פלפל אדום' });
});
afterAll(cleanup);

async function order(lines: Array<{ productId: string | null; raw: string }>) {
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, status: 'sent', source: 'manual', expectedDeliveryAt: new Date() })
    .returning({ id: purchaseOrders.id });
  for (const l of lines) {
    await db
      .insert(poLines)
      .values({ poId: po!.id, productId: l.productId, rawDescription: l.raw, qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '11' });
  }
  return po!.id;
}

async function invoiceWith(opts: { status: 'parsed' | 'matched'; reasons?: string[]; lineProductId: string | null; payload?: object }) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId,
      supplierId,
      status: opts.status,
      source: 'photo',
      invoiceDate: new Date(),
      totalExclVat: '22.00',
      ocrPayload: { provider: 'reconciled', raw: opts.reasons ? { reviewReasons: opts.reasons } : {}, ...(opts.payload ?? {}) } as never,
    })
    .returning({ id: invoices.id });
  const [line] = await db
    .insert(invoiceLines)
    .values({ invoiceId: inv!.id, productId: opts.lineProductId, rawDescription: 'פלפל אדום חריף', qtyBilled: '2', unit: 'ק״ג', unitPriceBilled: '11', lineTotal: '22' })
    .returning({ id: invoiceLines.id });
  return { invoiceId: inv!.id, lineId: line!.id };
}

async function status(id: string) {
  const [r] = await db.select({ status: invoices.status, payload: invoices.ocrPayload }).from(invoices).where(eq(invoices.id, id));
  return r!;
}
async function findings(invoiceId: string) {
  const runs = await db.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.invoiceId, invoiceId));
  const out: string[] = [];
  for (const r of runs) {
    out.push(...(await db.select({ t: discrepancies.type }).from(discrepancies).where(eq(discrepancies.matchRunId, r.id))).map((d) => d.t));
  }
  return { runs: runs.length, types: out };
}

describe('H-1: the job releases a question hold once every answer has committed', () => {
  it('held invoice whose lines were all answered (neither answer released it) → released, matched clean', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    // Two concurrent answers each saw the other's line unlinked → nobody released.
    const inv = await invoiceWith({ status: 'parsed', reasons: ['unlinked'], lineProductId: P });
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv.invoiceId, rematch: true });
    expect(out.skipped).toBeUndefined();
    expect(out.persisted).not.toBeNull();
    expect((await status(inv.invoiceId)).status).not.toBe('parsed');
    const f = await findings(inv.invoiceId);
    expect(f.runs).toBe(1);
    expect(f.types).not.toContain('MISSING_ON_INVOICE');
    expect(f.types).not.toContain('UNORDERED_ITEM');
  });

  it('still held while a line is unlinked, or when the hold has another reason (confidence)', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const open = await invoiceWith({ status: 'parsed', reasons: ['unlinked'], lineProductId: null });
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId: open.invoiceId, rematch: true })).skipped).toBe('awaiting_review');
    const lowConf = await invoiceWith({ status: 'parsed', reasons: ['confidence', 'unlinked'], lineProductId: P });
    expect((await matchInvoiceForJob(db, { restaurantId, invoiceId: lowConf.invoiceId, rematch: true })).skipped).toBe('awaiting_review');
    expect((await findings(open.invoiceId)).runs + (await findings(lowConf.invoiceId)).runs).toBe(0);
  });
});

describe('M-4: a first match waits for its order\'s questions', () => {
  it('order with an unlinked name-only line → held (unlinkedPo); after the answer → released and matched', async () => {
    const po = await order([
      { productId: P, raw: 'פלפל אדום' },
      { productId: null, raw: 'בצל סגול' },
    ]);
    const inv = await invoiceWith({ status: 'matched', lineProductId: P });
    const first = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv.invoiceId });
    expect(first.skipped).toBe('awaiting_review');
    const held = await status(inv.invoiceId);
    expect(held.status).toBe('parsed');
    const heldPayload = held.payload as unknown as { raw: { reviewReasons: string[] }; heldPoId: string };
    expect(heldPayload.raw.reviewReasons).toContain('unlinkedPo');
    expect(heldPayload.heldPoId).toBe(po);
    expect((await findings(inv.invoiceId)).runs).toBe(0);

    // The order line is answered (linked) → the re-match releases and matches.
    await db.update(poLines).set({ productId: P }).where(eq(poLines.poId, po));
    const after = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv.invoiceId, rematch: true });
    expect(after.persisted).not.toBeNull();
    expect((await status(inv.invoiceId)).status).not.toBe('parsed');
    expect((await findings(inv.invoiceId)).types).not.toContain('UNORDERED_ITEM');
  });
});

describe('LOW: an undo racing the release never leaves a run over an unlinked line', () => {
  it('a released invoice whose line is unlinked again → no run persisted', async () => {
    await order([{ productId: P, raw: 'פלפל אדום' }]);
    const inv = await invoiceWith({
      status: 'matched',
      reasons: ['unlinked'],
      lineProductId: null,
      payload: { linkReleasedAt: new Date().toISOString() },
    });
    const out = await matchInvoiceForJob(db, { restaurantId, invoiceId: inv.invoiceId });
    expect(out.persisted).toBeNull();
    expect((await findings(inv.invoiceId)).runs).toBe(0);
  });
});
