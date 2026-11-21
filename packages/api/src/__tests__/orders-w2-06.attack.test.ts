import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, poLines, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { PRICE_KEY } from '../orders/access';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-06 cross-tenant attacks: tenant A calls every new / changed orders
 * procedure with tenant B's supplierId / poId / productId → NOT_FOUND, and
 * nothing is written. Plus a deep scan of the receiver's payloads (no ₪ key).
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let bDraft: string;
const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

async function snapshotB() {
  const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.restaurantId, B.restaurantId));
  const lines = await db.select().from(poLines);
  const outbox = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.restaurantId, B.restaurantId));
  return JSON.stringify({ pos: pos.map((p) => [p.id, p.status, p.updatedAt]), lines: lines.filter((l) => pos.some((p) => p.id === l.poId)), outbox });
}

const notFound = { code: 'NOT_FOUND' };

describe('W2-06 orders — A → B attacks', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    await db.update(suppliers).set({ contactWhatsapp: '0525550000', contactEmail: 'b@supplier.test' }).where(eq(suppliers.id, B.supplierId));
    const { poId } = await callerFor(B).orders.createDraft({
      supplierId: B.supplierId,
      lines: [{ productId: B.productId, qty: 2, unit: 'kg', unitPriceExpected: 5 }],
    });
    bDraft = poId;
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it("orderGuide / openDraft: B's supplierId → NOT_FOUND", async () => {
    const before = await snapshotB();
    await expect(callerFor(A).orders.orderGuide({ supplierId: B.supplierId })).rejects.toMatchObject(notFound);
    await expect(callerFor(A).orders.openDraft({ supplierId: B.supplierId })).rejects.toMatchObject(notFound);
    expect(await snapshotB()).toBe(before);
  });

  it("saveDraft: B's supplierId, B's draftId or B's productId → NOT_FOUND, nothing written", async () => {
    const before = await snapshotB();
    const c = callerFor(A);
    await expect(c.orders.saveDraft({ supplierId: B.supplierId, lines: [], clientMutationId: 'atk-00001' })).rejects.toMatchObject(notFound);
    await expect(
      c.orders.saveDraft({ draftId: bDraft, supplierId: A.supplierId, lines: [], version: '1', clientMutationId: 'atk-00002' }),
    ).rejects.toMatchObject(notFound);
    await expect(
      c.orders.saveDraft({ supplierId: A.supplierId, lines: [{ productId: B.productId, qty: 1, unit: 'kg' }], clientMutationId: 'atk-00003' }),
    ).rejects.toMatchObject(notFound);
    expect(await snapshotB()).toBe(before);
    expect(await c.orders.openDraft({ supplierId: A.supplierId })).toBeNull(); // the refused save left no A draft either
  });

  it("markSentManually / prepareManualSend / addOrderLine / amendSent / sendMany: B's poId → NOT_FOUND", async () => {
    const before = await snapshotB();
    const c = callerFor(A);
    await expect(c.orders.markSentManually({ poId: bDraft, clientMutationId: 'atk-00004' })).rejects.toMatchObject(notFound);
    await expect(c.orders.prepareManualSend({ poId: bDraft })).rejects.toMatchObject(notFound);
    await expect(c.orders.addOrderLine({ poId: bDraft, line: { rawDescription: 'x', qty: 1, unit: 'kg' } })).rejects.toMatchObject(notFound);
    await expect(c.orders.amendSent({ poId: B.poId, changes: [{ qtyDelta: 1, unit: 'kg', rawDescription: 'x' }] })).rejects.toMatchObject(notFound);
    await expect(c.orders.sendMany({ items: [{ poId: bDraft, expectedStatus: 'draft' }], channel: 'email' })).rejects.toMatchObject(notFound);
    expect(await snapshotB()).toBe(before);
  });

  it("addOrderLine / updateOrderLine / amendSent: B's productId on A's PO → NOT_FOUND, A's draft unchanged", async () => {
    const c = callerFor(A);
    const { poId } = await c.orders.createDraft({ supplierId: A.supplierId, lines: [{ rawDescription: 'x', qty: 1, unit: 'kg' }] });
    const [l] = await db.select().from(poLines).where(eq(poLines.poId, poId));
    await expect(c.orders.addOrderLine({ poId, line: { productId: B.productId, qty: 1, unit: 'kg' } })).rejects.toMatchObject(notFound);
    await expect(c.orders.updateOrderLine({ lineId: l!.id, patch: { productId: B.productId } })).rejects.toMatchObject(notFound);
    await expect(c.orders.amendSent({ poId: A.poId, changes: [{ productId: B.productId, qtyDelta: 1, unit: 'kg' }] })).rejects.toMatchObject(notFound);
    const after = await db.select().from(poLines).where(eq(poLines.poId, poId));
    expect(after).toEqual([l]);
  });

  it("supplierBoard: A never sees B's suppliers or orders", async () => {
    const b = await callerFor(A).orders.supplierBoard();
    expect(b.rows.map((r) => r.supplierId)).toEqual([A.supplierId]);
    expect(JSON.stringify(b)).not.toContain(B.poId);
    expect(JSON.stringify(b)).not.toContain(bDraft);
  });

  it('receiver payloads: a deep scan finds no unitPrice*|total*|*Ils|*Agorot key', async () => {
    const r = callerFor(A, 'receiver');
    const payloads = { list: await r.orders.list(), get: await r.orders.get({ poId: A.poId }), board: await r.orders.supplierBoard() };
    const keys = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.flatMap(keys)
        : v && typeof v === 'object' && !(v instanceof Date)
          ? Object.entries(v).flatMap(([k, x]) => (PRICE_KEY.test(k) ? [k] : keys(x)))
          : [];
    expect(keys(payloads)).toEqual([]);
    expect(JSON.stringify(payloads)).not.toMatch(/"(unitPrice\w*|total\w*|\w+Ils|\w+Agorot)"/);
  });
});
