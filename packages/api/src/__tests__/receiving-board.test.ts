import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  goodsReceipts,
  grLines,
  memberships,
  poLines,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { israelToday } from './fixtures';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

/**
 * receiving.todayExpectations({ includeLate }) — the data behind the receiving
 * board (W1-05): a missed truck stays visible as "late" for a week instead of
 * vanishing at midnight; a received one never reads as late; a closed receipt
 * carries its close time ("התקבל ✓ 09:12"). The default call stays today-only.
 */
const db = createDb(testDbUrl());

async function resetDb() {
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

const DAY = 86_400_000;

async function seed() {
  const [restaurant] = await db.insert(restaurants).values({ name: 'Board Bistro' }).returning();
  const [receiver] = await db.insert(users).values({ email: 'board-receiver@test.local', name: 'R' }).returning();
  await db.insert(memberships).values({ userId: receiver!.id, restaurantId: restaurant!.id, role: 'receiver' });
  const [supplier] = await db.insert(suppliers).values({ restaurantId: restaurant!.id, name: 'ירקות השרון' }).returning();
  const rid = restaurant!.id;
  const today = israelToday(10);
  async function po(at: Date | null, status: 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled' = 'sent', createdAt?: Date) {
    const [row] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: rid, supplierId: supplier!.id, expectedDeliveryAt: at, status, source: 'manual', ...(createdAt ? { createdAt } : {}) })
      .returning();
    await db.insert(poLines).values({ poId: row!.id, rawDescription: 'עגבניה', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '8' });
    return row!.id;
  }
  async function receipt(poId: string, status: 'pending' | 'completed' | 'partial' | 'rejected') {
    const [gr] = await db.insert(goodsReceipts).values({ restaurantId: rid, poId, receivedBy: receiver!.id, status }).returning();
    return gr!.id;
  }
  const session: Session = { userId: receiver!.id, restaurantId: rid, role: 'receiver' };
  const caller = appRouter.createCaller({ db, session } as AppContext);
  return { rid, today, po, receipt, caller };
}

beforeEach(resetDb);
afterAll(resetDb);

describe('receiving.todayExpectations — receiving board', () => {
  it('the default call stays today-only: yesterday’s open PO is not listed', async () => {
    const s = await seed();
    const todayPo = await s.po(s.today);
    await s.po(new Date(s.today.getTime() - DAY));
    const list = await s.caller.receiving.todayExpectations();
    expect(list.map((e) => e.poId)).toEqual([todayPo]);
    expect(list[0]).toMatchObject({ late: false, closedAt: null });
  });

  it('includeLate: an open PO dated in the last week is listed and flagged late (oldest first)', async () => {
    const s = await seed();
    const todayPo = await s.po(s.today);
    const yesterday = await s.po(new Date(s.today.getTime() - DAY));
    const threeDays = await s.po(new Date(s.today.getTime() - 3 * DAY));
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    expect(list.map((e) => e.poId)).toEqual([threeDays, yesterday, todayPo]);
    expect(list.map((e) => e.late)).toEqual([true, true, false]);
  });

  it('includeLate: a started (pending) receipt on a past day is still late; a closed one is not listed', async () => {
    const s = await seed();
    const started = await s.po(new Date(s.today.getTime() - DAY));
    await s.receipt(started, 'pending');
    const arrived = await s.po(new Date(s.today.getTime() - DAY));
    const arrivedGr = await s.receipt(arrived, 'completed');
    const short = await s.po(new Date(s.today.getTime() - 2 * DAY), 'partial');
    const shortGr = await s.receipt(short, 'partial');
    // Closed on their own (earlier) days: history, not today's board.
    await db.update(goodsReceipts).set({ updatedAt: new Date(s.today.getTime() - DAY) }).where(eq(goodsReceipts.id, arrivedGr));
    await db.update(goodsReceipts).set({ updatedAt: new Date(s.today.getTime() - 2 * DAY) }).where(eq(goodsReceipts.id, shortGr));
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    expect(list.map((e) => e.poId)).toEqual([started]);
    expect(list[0]).toMatchObject({ late: true, receiptStatus: 'pending', closedAt: null });
  });

  it('includeLate: a late truck received TODAY stays on the board as received (not late, not gone)', async () => {
    const s = await seed();
    const yesterdays = await s.po(new Date(s.today.getTime() - DAY));
    await s.receipt(yesterdays, 'completed'); // closed now (updatedAt = now)
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ poId: yesterdays, receiptStatus: 'completed', late: false });
    expect(list[0]!.closedAt).not.toBeNull();
  });

  it('includeLate: older than a week, cancelled, or another restaurant’s PO never shows', async () => {
    const s = await seed();
    await s.po(new Date(s.today.getTime() - 9 * DAY));
    await s.po(new Date(s.today.getTime() - DAY), 'cancelled');
    const [r2] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [sup2] = await db.insert(suppliers).values({ restaurantId: r2!.id, name: 'Foreign' }).returning();
    await db.insert(purchaseOrders).values({
      restaurantId: r2!.id,
      supplierId: sup2!.id,
      expectedDeliveryAt: new Date(s.today.getTime() - DAY),
      status: 'sent',
      source: 'manual',
    });
    expect(await s.caller.receiving.todayExpectations({ includeLate: true })).toEqual([]);
  });

  it('a closed receipt today carries its close time; an open one does not', async () => {
    const s = await seed();
    const done = await s.po(s.today);
    const gr = await s.receipt(done, 'completed');
    const closedAt = new Date(s.today.getTime() - 30 * 60_000);
    await db.update(goodsReceipts).set({ updatedAt: closedAt }).where(eq(goodsReceipts.id, gr));
    const open = await s.po(new Date(s.today.getTime() + 60 * 60_000));
    await s.receipt(open, 'pending');
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    const byId = new Map(list.map((e) => [e.poId, e]));
    expect(byId.get(done)).toMatchObject({ receiptStatus: 'completed', closedAt: closedAt.toISOString(), late: false });
    expect(byId.get(open)).toMatchObject({ receiptStatus: 'pending', closedAt: null });
  });

  it('"late" follows the goods receipt, never the PO status', async () => {
    const s = await seed();
    // A platform sync marked the PO 'partial' but nothing was received here: late.
    const syncedPartial = await s.po(new Date(s.today.getTime() - DAY), 'partial');
    // The PO was closed after its receipt was completed today: received, not gone.
    const closedToday = await s.po(new Date(s.today.getTime() - DAY), 'closed');
    await s.receipt(closedToday, 'completed');
    // A turned-away truck (rejected receipt) is closed, not late.
    const rejected = await s.po(new Date(s.today.getTime() - DAY));
    await s.receipt(rejected, 'rejected');
    // A PO closed without any receipt here is not a truck to receive.
    await s.po(new Date(s.today.getTime() - DAY), 'closed');
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    const byId = new Map(list.map((e) => [e.poId, e]));
    expect(new Set(byId.keys())).toEqual(new Set([syncedPartial, closedToday, rejected]));
    expect(byId.get(syncedPartial)).toMatchObject({ late: true, receiptStatus: null });
    expect(byId.get(closedToday)).toMatchObject({ late: false, receiptStatus: 'completed' });
    expect(byId.get(rejected)).toMatchObject({ late: false, receiptStatus: 'rejected' });
    expect(byId.get(rejected)!.closedAt).not.toBeNull();
  });

  it('undated recent POs keep their R5 place (no date → never "late")', async () => {
    const s = await seed();
    const undated = await s.po(null, 'sent', new Date(s.today.getTime() - 2 * DAY));
    const list = await s.caller.receiving.todayExpectations({ includeLate: true });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ poId: undated, hasDeliveryDate: false, late: false });
  });
});
