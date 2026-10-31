import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  inArray,
  invoiceLines,
  invoices,
  productAliases,
  products,
  recoveryClaims,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W1-10 · catalog-03: linking a SKU backfills product_id on already-imported
 * lines, so those invoices' findings (and the leak ₪) must be recomputed. The
 * confirm enqueues a re-match per affected invoice — skipping a consolidated
 * invoice, a signed-off one, and one with a credit claim (reported, never
 * silently dropped) — and "בטל" puts exactly those lines back.
 */
type Job = { restaurantId: string; invoiceId: string; rematch?: boolean };
const enqueued: Array<{ queue: string; payload: Job; runAt?: Date; at: number }> = [];
/** Simulated queue latency per enqueue (ms). */
const latency = { ms: 0 };
const fail = { on: null as string | null };
vi.mock('@restomatch/queue', async (orig) => {
  const real = await orig<typeof import('@restomatch/queue')>();
  return {
    ...real,
    enqueue: async (queue: string, payload: Job, opts?: { runAt?: Date }) => {
      if (fail.on === payload.invoiceId) throw new real.QueueUnavailableError(queue, 'down');
      if (latency.ms) await new Promise((res) => setTimeout(res, latency.ms));
      enqueued.push({ queue, payload, runAt: opts?.runAt, at: Date.now() });
      return true;
    },
  };
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const SKU = 'TM-77';

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function invoiceWithLine(
  t: Tenant,
  over: Partial<typeof invoices.$inferInsert> = {},
): Promise<{ invoiceId: string; lineId: string }> {
  const [inv] = await db
    .insert(invoices)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'matched', source: 'photo', ...over })
    .returning({ id: invoices.id });
  const lineId = await lineOn(inv!.id);
  return { invoiceId: inv!.id, lineId };
}
async function lineOn(invoiceId: string) {
  const [l] = await db
    .insert(invoiceLines)
    .values({ invoiceId, rawDescription: 'עגבניות שרי', supplierSku: SKU, unit: 'ק״ג', qtyBilled: '5', unitPriceBilled: '9', lineTotal: '45' })
    .returning({ id: invoiceLines.id });
  return l!.id;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  enqueued.length = 0;
  fail.on = null;
  latency.ms = 0;
});
afterAll(() => resetDb(db));

describe('mapping.confirm re-matches the affected invoices', () => {
  it('enqueues a delayed rematch per affected invoice; skips consolidated / settled / claimed, and reports them', async () => {
    const plain = await invoiceWithLine(A);
    const second = await lineOn(plain.invoiceId); // two lines, one invoice → one job
    const consolidated = await invoiceWithLine(A, { ocrPayload: { raw: { kind: 'consolidated' } } as never });
    const approved = await invoiceWithLine(A, { status: 'approved' });
    // A credit claim on the seeded invoice's finding (₪-back tracker) blocks its re-match.
    await lineOn(A.invoiceId);
    await db.insert(recoveryClaims).values({
      restaurantId: A.restaurantId,
      discrepancyId: A.discrepancyId,
      invoiceId: A.invoiceId,
      supplierId: A.supplierId,
      amountAgorot: 4500,
    });
    const foreign = await invoiceWithLine(B);

    const before = Date.now();
    const res = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'עגבניות שרי',
      productId: A.productId,
    });

    expect(res.invoiceLinesUpdated).toBe(5);
    expect(res.rematch).toEqual({ requeued: 1, blockedByClaims: 1, consolidated: 1, settled: 1, failed: 0 });
    expect(enqueued.map((e) => [e.queue, e.payload])).toEqual([
      ['match-invoice', { restaurantId: A.restaurantId, invoiceId: plain.invoiceId, rematch: true }],
    ]);
    // Delayed past this request's commit, so the job reads the linked lines.
    expect(enqueued[0]!.runAt!.getTime()).toBeGreaterThanOrEqual(before + 2_000);
    expect(res.undo?.invoiceLineIds).toEqual(expect.arrayContaining([plain.lineId, second]));
    // B's identical SKU is untouched.
    const [fl] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, foreign.lineId));
    expect(fl!.productId).toBeNull();
    void consolidated;
    void approved;
  });

  it('a queue failure never fails the link — it is reported', async () => {
    const plain = await invoiceWithLine(A);
    fail.on = plain.invoiceId;
    const res = await callerFor(A).mapping.confirm({ supplierId: A.supplierId, supplierSku: SKU, rawName: 'x', productId: A.productId });
    expect(res.invoiceLinesUpdated).toBe(1);
    expect(res.rematch).toMatchObject({ requeued: 0, failed: 1 });
  });

  it('"בטל" unlinks exactly those lines, drops the alias it created, and re-matches again', async () => {
    const plain = await invoiceWithLine(A);
    const res = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'עגבניות שרי',
      productId: A.productId,
    });
    expect(res.undo?.aliasId).toBeTruthy();
    // A line linked by someone else after the confirm is not in the undo set.
    const later = await lineOn(plain.invoiceId);
    await db.update(invoiceLines).set({ productId: A.productId }).where(eq(invoiceLines.id, later));
    enqueued.length = 0;

    const undone = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'עגבניות שרי',
      revert: res.undo!,
    });
    expect(undone.invoiceLinesUpdated).toBe(1);
    const lines = await db.select().from(invoiceLines).where(inArray(invoiceLines.id, [plain.lineId, later]));
    expect(lines.find((l) => l.id === plain.lineId)!.productId).toBeNull();
    expect(lines.find((l) => l.id === later)!.productId).toBe(A.productId);
    expect(await db.select().from(productAliases).where(eq(productAliases.id, res.undo!.aliasId!))).toEqual([]);
    expect(enqueued.map((e) => e.payload.invoiceId)).toEqual([plain.invoiceId]);
  });

  it('a revert naming another tenant’s lines / supplier changes nothing (tenant attack)', async () => {
    const theirs = await invoiceWithLine(B);
    const linked = await callerFor(B).mapping.confirm({ supplierId: B.supplierId, supplierSku: SKU, rawName: 'x', productId: B.productId });
    // A replays B's undo token under A's own supplier: no B row matches A's scope.
    const res = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'x',
      revert: linked.undo!,
    });
    expect(res.invoiceLinesUpdated).toBe(0);
    // …and under B's supplier id it is rejected before anything runs.
    await expect(
      callerFor(A).mapping.confirm({ supplierId: B.supplierId, supplierSku: SKU, rawName: 'x', revert: linked.undo! }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [l] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, theirs.lineId));
    expect(l!.productId).toBe(B.productId);
    expect(await db.select().from(productAliases).where(eq(productAliases.id, linked.undo!.aliasId!))).toHaveLength(1);
  });

  it('finding 8: each job is delayed from its own enqueue, so a slow queue can\'t expire the guard', async () => {
    const one = await invoiceWithLine(A);
    const two = await invoiceWithLine(A);
    latency.ms = 400;
    await callerFor(A).mapping.confirm({ supplierId: A.supplierId, supplierSku: SKU, rawName: 'x', productId: A.productId });
    expect(enqueued.map((e) => e.payload.invoiceId).sort()).toEqual([one.invoiceId, two.invoiceId].sort());
    for (const e of enqueued) expect(e.runAt!.getTime()).toBeGreaterThanOrEqual(e.at + 2_000);
  });

  it('finding 9: undoing a link that made a new product removes that product too', async () => {
    await invoiceWithLine(A);
    const res = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'עגבניות שרי',
      newProductName: 'עגבניות שרי חדש',
    });
    expect(res.createdProduct).toBe(true);
    await callerFor(A).mapping.confirm({ supplierId: A.supplierId, supplierSku: SKU, rawName: 'עגבניות שרי', revert: res.undo! });
    expect(await db.select().from(products).where(eq(products.id, res.productId))).toEqual([]);
  });

  it('finding 9: …but keeps an existing product, and one still used elsewhere', async () => {
    const plain = await invoiceWithLine(A);
    const res = await callerFor(A).mapping.confirm({
      supplierId: A.supplierId,
      supplierSku: SKU,
      rawName: 'עגבניות שרי',
      newProductName: 'עגבניות שרי חדש',
    });
    // Someone links another line to the new product before the undo.
    const other = await lineOn(plain.invoiceId);
    await db.update(invoiceLines).set({ productId: res.productId, supplierSku: 'OTHER' }).where(eq(invoiceLines.id, other));
    await callerFor(A).mapping.confirm({ supplierId: A.supplierId, supplierSku: SKU, rawName: 'עגבניות שרי', revert: res.undo! });
    expect(await db.select().from(products).where(eq(products.id, res.productId))).toHaveLength(1);
    const [l] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, other));
    expect(l!.productId).toBe(res.productId);
  });
});
