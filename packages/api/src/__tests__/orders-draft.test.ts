import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, createDb, eq, goodsReceipts, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-06 §5.7 — the server draft (orders-07 P0): saved at every line, never lost. */
const db = createDb(testDbUrl());
let A: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const line = (qty: number, rawDescription = 'עגבניות') => ({ productId: A.productId, rawDescription, qty, unit: 'kg' });
let n = 0;
const cmid = () => `cmid-${++n}-${Date.now()}`;

async function draftsOf(supplierId: string) {
  return db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.supplierId, supplierId), eq(purchaseOrders.status, 'draft')));
}

describe('orders.saveDraft / orders.openDraft', () => {
  beforeEach(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('first save creates the draft; openDraft (any browser, same user) restores it with a version', async () => {
    const c = callerFor(A);
    const saved = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    expect(saved).toMatchObject({ supplierId: A.supplierId, replayed: false, lines: [{ qty: 3, unit: 'kg' }] });
    expect(saved.version).toMatch(/^\d+$/);
    const opened = await callerFor(A).orders.openDraft({ supplierId: A.supplierId });
    expect(opened).toMatchObject({ draftId: saved.draftId, version: saved.version, lines: [{ qty: 3 }] });
  });

  it('a save with the current version replaces the lines and bumps the version', async () => {
    const c = callerFor(A);
    const a = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    const b = await c.orders.saveDraft({
      draftId: a.draftId,
      supplierId: A.supplierId,
      lines: [line(3), line(2, 'בצל')],
      version: a.version,
      clientMutationId: cmid(),
    });
    expect(b.draftId).toBe(a.draftId);
    expect(b.version).not.toBe(a.version);
    expect(b.lines).toHaveLength(2);
  });

  it('a stale version → CONFLICT naming who and when; nothing is overwritten', async () => {
    const c = callerFor(A);
    const a = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    await c.orders.saveDraft({ draftId: a.draftId, supplierId: A.supplierId, lines: [line(4)], version: a.version, clientMutationId: cmid() });
    await expect(
      c.orders.saveDraft({ draftId: a.draftId, supplierId: A.supplierId, lines: [line(9)], version: a.version, clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringMatching(/^DRAFT_STALE:Owner A:\d{4}-/) });
    expect((await c.orders.openDraft({ supplierId: A.supplierId }))!.lines[0]!.qty).toBe(4);
  });

  it('a replay (same content, old version) returns the recorded draft, not a CONFLICT', async () => {
    const c = callerFor(A);
    const a = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    const b = await c.orders.saveDraft({ draftId: a.draftId, supplierId: A.supplierId, lines: [line(5)], version: a.version, clientMutationId: 'replay-1234' });
    const again = await c.orders.saveDraft({ draftId: a.draftId, supplierId: A.supplierId, lines: [line(5)], version: a.version, clientMutationId: 'replay-1234' });
    expect(again).toMatchObject({ draftId: b.draftId, version: b.version, replayed: true });
  });

  it('2 concurrent first saves → 1 draft', async () => {
    const lines = [line(3)];
    const r = await Promise.allSettled([
      callerFor(A).orders.saveDraft({ supplierId: A.supplierId, lines, clientMutationId: cmid() }),
      callerFor(A).orders.saveDraft({ supplierId: A.supplierId, lines, clientMutationId: cmid() }),
    ]);
    expect(r.every((x) => x.status === 'fulfilled')).toBe(true);
    expect(await draftsOf(A.supplierId)).toHaveLength(1);
  });

  it('a PO with a goods receipt → CONFLICT; a sent PO → CONFLICT', async () => {
    const c = callerFor(A);
    const a = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId: a.draftId, receivedBy: A.ownerUserId, status: 'pending' });
    await expect(
      c.orders.saveDraft({ draftId: a.draftId, supplierId: A.supplierId, lines: [line(4)], version: a.version, clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'DRAFT_HAS_RECEIPT' });
    await expect(
      c.orders.saveDraft({ draftId: A.poId, supplierId: A.supplierId, lines: [line(4)], version: '1', clientMutationId: cmid() }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a supplier switch keeps both drafts', async () => {
    const [s2] = await db.insert(suppliers).values({ restaurantId: A.restaurantId, name: 'ספק 2' }).returning({ id: suppliers.id });
    const c = callerFor(A);
    await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    await c.orders.saveDraft({ supplierId: s2!.id, lines: [line(1, 'חלב')], clientMutationId: cmid() });
    expect((await c.orders.openDraft({ supplierId: A.supplierId }))!.lines[0]!.qty).toBe(3);
    expect((await c.orders.openDraft({ supplierId: s2!.id }))!.lines[0]!.rawDescription).toBe('חלב');
  });

  it('after a send (incl. a send retried after a reload), a new order for the same supplier starts empty', async () => {
    const c = callerFor(A);
    const a = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(3)], clientMutationId: cmid() });
    // The page reloads inside the undo window: the draft is reopened, then sent once.
    const reopened = await c.orders.openDraft({ supplierId: A.supplierId });
    expect(reopened?.draftId).toBe(a.draftId);
    await c.orders.placeOrder({ poId: a.draftId, channel: 'none' });
    // A retried send of the same PO is refused, never a second order.
    await expect(c.orders.placeOrder({ poId: a.draftId, channel: 'none' })).rejects.toMatchObject({ code: 'CONFLICT' });
    // A sent order never comes back as the open draft.
    expect(await c.orders.openDraft({ supplierId: A.supplierId })).toBeNull();
    // The next save starts a NEW draft and does not touch the sent PO.
    const next = await c.orders.saveDraft({ supplierId: A.supplierId, lines: [line(1, 'בצל')], clientMutationId: cmid() });
    expect(next.draftId).not.toBe(a.draftId);
    expect(next.lines).toHaveLength(1);
    const [sent] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, a.draftId));
    expect(sent?.status).toBe('sent');
  });
});
