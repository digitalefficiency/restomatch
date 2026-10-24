import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, eq, goodsReceipts, grLines, restaurants, testDbUrl } from '@restomatch/db';
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

const callerFor = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

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
      .set({ settings: { features: { receiveRest: on } } as (typeof restaurants.$inferInsert)['settings'] })
      .where(eq(restaurants.id, t.restaurantId));
  beforeEach(() => flag(A, true));

  it('flag receiveRest off ⇒ FORBIDDEN, the partial receipt stays closed', async () => {
    await flag(A, false);
    await callerFor(A).receiving.submitReceipt({ grId: A.grId });
    await expect(callerFor(A).receiving.reopenReceipt({ grId: A.grId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [gr] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.id, A.grId));
    expect(gr!.status).toBe('partial');
    expect((await callerFor(A).receiving.getPo({ poId: A.poId })).features.receiveRest).toBe(false);
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
