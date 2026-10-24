import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, auditLog, createDb, eq, goodsReceipts, grLines, restaurants, testDbUrl } from '@restomatch/db';
import { lockReceipt } from '../receiving/matchTriggers';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const enqueueMatchInvoice = vi.fn(async () => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueMatchInvoice: () => enqueueMatchInvoice(),
}));

/**
 * A goods receipt is closed once. Reopening the PO (a reload, a second tab, the
 * demo presenter going back) must never rewrite a closed count or re-match it:
 * markGrLine / submitReceipt on a completed/partial receipt → CONFLICT
 * 'receipt.closed'; getPo reports the closed receipt so the page opens it
 * read-only. A foreign receipt stays NOT_FOUND (no existence leak).
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const callerFor = (t: Tenant, role: 'owner' | 'manager' | 'receiver' = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'RA');
  B = await seedTenant(db, 'RB');
  enqueueMatchInvoice.mockClear();
});
afterAll(() => resetDb(db));

describe('a closed receipt is read-only', () => {
  it('getPo: no closedReceipt while counting; after the close it names the receipt + its invoice', async () => {
    expect((await callerFor(A).receiving.getPo({ poId: A.poId })).closedReceipt).toBeNull();
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    const po = await callerFor(A).receiving.getPo({ poId: A.poId });
    expect(po.closedReceipt).toMatchObject({ grId: A.grId, invoiceId: A.invoiceId });
    expect(['completed', 'partial']).toContain(po.closedReceipt!.status);
  });

  it('a second submit is CONFLICT receipt.closed — status, close time and the queue untouched', async () => {
    const first = await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    enqueueMatchInvoice.mockClear();
    await expect(callerFor(A).receiving.submitReceipt({ grId: A.grId })).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'receipt.closed' },
    });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(gr!.status).toBe(first.status);
    expect(new Date(gr!.updatedAt).getTime()).toBe(new Date(first.updatedAt).getTime());
    expect(enqueueMatchInvoice).not.toHaveBeenCalled();
  });

  it('markGrLine on a closed receipt is CONFLICT receipt.closed and the count is unchanged', async () => {
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    const [before] = await db.select().from(grLines).where(eq(grLines.id, A.grLineId));
    await expect(callerFor(A).receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 0 })).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'receipt.closed' },
    });
    const [after] = await db.select().from(grLines).where(eq(grLines.id, A.grLineId));
    expect(after!.qtyReceived).toBe(before!.qtyReceived);
  });

  it('while counting, markGrLine still works', async () => {
    const updated = await callerFor(A).receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 3 });
    expect(Number(updated.qtyReceived)).toBe(3);
  });

  it("another tenant's closed receipt stays NOT_FOUND (never CONFLICT — no existence leak)", async () => {
    await callerFor(B).receiving.submitReceipt({ grId: B.grId });
    await expect(callerFor(A).receiving.markGrLine({ grLineId: B.grLineId, qtyReceived: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(callerFor(A).receiving.submitReceipt({ grId: B.grId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await callerFor(A).receiving.getPo({ poId: A.poId })).closedReceipt).toBeNull();
  });
});

describe('receive the rest — reopenReceipt', () => {
  const flag = (t: Tenant, on: boolean) =>
    db
      .update(restaurants)
      .set({ settings: { features: { receiptReopen: on } } as (typeof restaurants.$inferInsert)['settings'] })
      .where(eq(restaurants.id, t.restaurantId));
  beforeEach(() => flag(A, true));

  it('flag receiptReopen off ⇒ FORBIDDEN, the partial receipt stays closed', async () => {
    await flag(A, false);
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    await expect(callerFor(A).receiving.reopenReceipt({ grId: A.grId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(gr!.status).toBe('partial');
    expect((await callerFor(A).receiving.getPo({ poId: A.poId })).features.receiptReopen).toBe(false);
  });

  it('a partial receipt reopens for the next delivery: cumulative count → completed, re-matched', async () => {
    const first = await callerFor(A).receiving.submitReceipt({ grId: A.grId }); // 5 of 10
    expect(first.status).toBe('partial');
    enqueueMatchInvoice.mockClear();

    expect(await callerFor(A).receiving.reopenReceipt({ grId: A.grId })).toEqual({ grId: A.grId, status: 'pending' });
    // Open again: getPo no longer reports it closed, and the count takes edits.
    expect((await callerFor(A).receiving.getPo({ poId: A.poId })).closedReceipt).toBeNull();
    // The wizard stores the running total (5 already + 5 now).
    await callerFor(A).receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 10 });
    const second = await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    expect(second.status).toBe('completed');
    // The second close re-matches the receipt's invoices (the first one included).
    expect(enqueueMatchInvoice).toHaveBeenCalled();
    // Completed is final.
    await expect(callerFor(A).receiving.reopenReceipt({ grId: A.grId })).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'receipt.closed' },
    });
  });

  it('a pending receipt is returned as is (a double tap), its count untouched', async () => {
    const [before] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(await callerFor(A).receiving.reopenReceipt({ grId: A.grId })).toEqual({ grId: A.grId, status: 'pending' });
    const [after] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(after).toEqual(before);
  });

  it("another tenant's partial receipt is NOT_FOUND and stays closed", async () => {
    await callerFor(B).receiving.submitReceipt({ grId: B.grId });
    await expect(callerFor(A).receiving.reopenReceipt({ grId: B.grId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, B.grId));
    expect(gr!.status).toBe('partial');
  });
});

describe('the way out of a closed receipt', () => {
  const flag = (on: boolean) =>
    db
      .update(restaurants)
      .set({ settings: { features: { receiptReopen: on } } as (typeof restaurants.$inferInsert)['settings'] })
      .where(eq(restaurants.id, A.restaurantId));
  beforeEach(() => flag(true));
  const audits = (action: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.entityId, A.grId), eq(auditLog.action, action)));

  it('the CONFLICT text is Hebrew (clients key off the appCode)', async () => {
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    await expect(callerFor(A).receiving.submitReceipt({ grId: A.grId })).rejects.toMatchObject({
      message: expect.stringMatching(/[א-ת]/),
    });
  });

  it('תיקון ספירה: a manager corrects a COMPLETED count — audited, re-counted as a total, re-matched', async () => {
    await callerFor(A).receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 10 });
    expect((await callerFor(A).receiving.submitReceipt({ grId: A.grId })).status).toBe('completed');
    // receive-the-rest is for a partial receipt only
    await expect(callerFor(A).receiving.reopenReceipt({ grId: A.grId })).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await callerFor(A, 'manager').receiving.correctReceipt({ grId: A.grId })).toEqual({ grId: A.grId, status: 'pending' });
    const [audit] = await audits('receiving.count_corrected');
    expect(audit).toMatchObject({ restaurantId: A.restaurantId, userId: A.ownerUserId, entityType: 'goods_receipt' });
    expect(audit!.before).toEqual({ status: 'completed' });
    expect(audit!.after).toEqual({ status: 'pending' });

    enqueueMatchInvoice.mockClear();
    await callerFor(A).receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 8 }); // the real count
    expect((await callerFor(A).receiving.submitReceipt({ grId: A.grId })).status).toBe('partial');
    expect(enqueueMatchInvoice).toHaveBeenCalled();
  });

  it('a receiver cannot correct a count (owner / manager only); the receipt stays closed', async () => {
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    await expect(callerFor(A, 'receiver').receiving.correctReceipt({ grId: A.grId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(gr!.status).not.toBe('pending');
    expect(await audits('receiving.count_corrected')).toHaveLength(0);
  });

  it('flag off ⇒ correction FORBIDDEN', async () => {
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    await flag(false);
    await expect(callerFor(A).receiving.correctReceipt({ grId: A.grId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('receive the rest is audited too', async () => {
    await callerFor(A).receiving.submitReceipt({ grId: A.grId }); // 5 of 10 → partial
    await callerFor(A).receiving.reopenReceipt({ grId: A.grId });
    const [audit] = await audits('receiving.receipt_reopened');
    expect(audit!.before).toEqual({ status: 'partial' });
  });

  it('markGrLine waits for an in-flight close (receipt lock), then is CONFLICT — never a write after the status was computed', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    // The close: lock, compute + write the status, commit later.
    const close = db.transaction(async (tx) => {
      await lockReceipt(tx as unknown as typeof db, A.grId);
      await tx.update(goodsReceipts).set({ status: 'partial' }).where(eq(goodsReceipts.id, A.grId));
      locked();
      await held;
    });
    await lockTaken;
    let settled = false;
    const edit = db
      .transaction((tx) =>
        appRouter
          .createCaller({ db: tx, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' } } as unknown as AppContext)
          .receiving.markGrLine({ grLineId: A.grLineId, qtyReceived: 9 }),
      )
      .finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // blocked on the lock
    release();
    await close;
    await expect(edit).rejects.toMatchObject({ code: 'CONFLICT', cause: { appCode: 'receipt.closed' } });
    const [line] = await db.select().from(grLines).where(eq(grLines.id, A.grLineId));
    expect(Number(line!.qtyReceived)).toBe(5);
  });
});
