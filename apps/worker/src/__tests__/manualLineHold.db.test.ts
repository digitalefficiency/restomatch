import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  and,
  createDb,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  users,
} from '@restomatch/db';
import { appRouter, type AppContext } from '@restomatch/api';
import { matchInvoiceForJob, type MatchInvoiceJob } from '../jobs/matchInvoice';

const enqueued: MatchInvoiceJob[] = [];
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueOcrInvoice: async () => true,
  enqueueMatchInvoice: async (job: MatchInvoiceJob) => {
    enqueued.push(job);
    return true;
  },
}));

/**
 * #216 round 2, item 1 — END TO END. A hand line typed while the receipt is
 * still being counted must not be matched against an empty count (every line
 * "short"), and must not be lost either: it is HELD for the receipt
 * (raw.heldForReceipts) and submitReceipt's re-match — the REAL worker job —
 * matches it once the count is in.
 */
const db = createDb(testDbUrl());
let restaurantId = '';
let userId = '';
let poLineId = '';
let grId = '';
let grLineId = '';
let supplierId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(matchRuns).where(eq(matchRuns.restaurantId, restaurantId));
  for (const i of await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.restaurantId, restaurantId)))
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, i.id));
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  for (const g of await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId)))
    await db.delete(grLines).where(eq(grLines.grId, g.id));
  await db.delete(goodsReceipts).where(eq(goodsReceipts.restaurantId, restaurantId));
  for (const p of await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId)))
    await db.delete(poLines).where(eq(poLines.poId, p.id));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.restaurantId, restaurantId));
  await db.delete(products).where(eq(products.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(memberships).where(eq(memberships.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

beforeEach(async () => {
  await cleanup();
  enqueued.length = 0;
  const [r] = await db.insert(restaurants).values({ name: 'Manual-line hold test', vatRate: '0.18' }).returning();
  restaurantId = r!.id;
  const [u] = await db
    .insert(users)
    .values({ email: `hold-${restaurantId.slice(0, 8)}@test.local`, name: 'Owner', emailVerified: new Date() })
    .returning();
  userId = u!.id;
  await db.insert(memberships).values({ userId, restaurantId, role: 'owner' });
  const [s] = await db.insert(suppliers).values({ restaurantId, name: 'ספק שמן', vatRate: '0.18' }).returning();
  supplierId = s!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId, canonicalName: 'שמן זית', category: 'שמנים', defaultUnit: 'ליטר' })
    .returning();
  const [po] = await db
    .insert(purchaseOrders)
    .values({ restaurantId, supplierId, expectedDeliveryAt: new Date(), status: 'sent', source: 'manual' })
    .returning();
  const [pl] = await db
    .insert(poLines)
    .values({ poId: po!.id, productId: p!.id, rawDescription: 'שמן זית 1 ליטר', qtyOrdered: '10', unit: 'ליטר', unitPriceExpected: '125' })
    .returning();
  poLineId = pl!.id;
  const [gr] = await db.insert(goodsReceipts).values({ restaurantId, poId: po!.id, receivedBy: userId, status: 'pending' }).returning();
  grId = gr!.id;
  const [gl] = await db.insert(grLines).values({ grId, poLineId, productId: p!.id, qtyReceived: '0' }).returning();
  grLineId = gl!.id;
});

afterAll(cleanup);

const as = (role: 'owner' | 'receiver') =>
  appRouter.createCaller({ db, session: { userId, restaurantId, role } } as unknown as AppContext);

describe('#216 item 1: a hand line on an open receipt is held, then matched by the real submit → match job', () => {
  it('addInvoiceLine while counting → held (no run); submitReceipt → matchInvoiceForJob → PRICE_HIGHER', async () => {
    const reg = await as('receiver').receiving.registerInvoice({ grId, imageUrl: 'https://example.com/scans/oil.jpg', supplierId });
    // The read failed (the worker's terminal state), the receipt stamp kept.
    await db
      .update(invoices)
      .set({ status: 'parsed', ocrConfidence: '0', ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'extraction_failed', scanGrId: grId } } })
      .where(eq(invoices.id, reg.invoiceId));

    // Billed 132 vs ordered 125 — typed by hand while the receipt is still open.
    const added = await as('owner').receiving.addInvoiceLine({
      invoiceId: reg.invoiceId,
      line: { rawDescription: 'שמן זית 1 ליטר', qtyBilled: 10, unit: 'ליטר', unitPriceBilled: 132, poLineId },
    });
    expect(added.rematched).toBe(false);
    expect(added.rematchSkipped).toBe('receipt_open');
    const [held] = await db.select().from(invoices).where(eq(invoices.id, reg.invoiceId));
    expect(held!.status).toBe('matched'); // past the OCR's review gate: the submit may match it
    expect((held!.ocrPayload?.raw as { heldForReceipts?: string[] }).heldForReceipts).toEqual([grId]);
    expect(await db.select().from(matchRuns).where(eq(matchRuns.invoiceId, reg.invoiceId))).toHaveLength(0);

    // The count lands "= order" and the receipt is submitted.
    await db.update(grLines).set({ qtyReceived: '10' }).where(eq(grLines.id, grLineId));
    await as('receiver').receiving.submitReceipt({ grId });
    const job = enqueued.find((j) => j.invoiceId === reg.invoiceId);
    expect(job).toBeDefined();

    // The REAL worker job matches it against the count.
    const out = await matchInvoiceForJob(db, job!);
    expect(out.skipped).toBeUndefined();
    expect(out.persisted).not.toBeNull();
    const types = (
      await db
        .select({ type: discrepancies.type })
        .from(discrepancies)
        .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
        .where(and(eq(matchRuns.invoiceId, reg.invoiceId), eq(matchRuns.restaurantId, restaurantId)))
    ).map((r) => r.type);
    expect(types).toContain('PRICE_HIGHER');
    expect(types).not.toContain('QTY_SHORT');
  });
});
