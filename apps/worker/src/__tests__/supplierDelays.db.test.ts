import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deliveryState, poDeliveryStateSql } from '@restomatch/api';
import {
  and,
  createDb,
  eq,
  goodsReceipts,
  memberships,
  notificationsOutbox,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
  users,
} from '@restomatch/db';
import { processSupplierDelays } from '../jobs/supplierDelays';
import type { WorkerJob } from '../queue';

/**
 * G-01 (live bug): the daily "late delivery" e-mail went out for POs that were
 * already delivered — receiving never moves a PO out of 'sent', and the sweep
 * read only the PO status. Now: open = sent|confirmed AND no goods receipt, and
 * a missing delivery is chased on days 1, 3 and 7 only.
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const job = <T>(data: T): WorkerJob<T> => ({ id: 't', name: 't', data, attemptsMade: 0, opts: { attempts: 1 } });

// Expected Mon 2 Nov 2026 08:00 IST; the job runs at 10:00 IST (08:00Z) each day.
const EXPECTED = new Date('2026-11-02T06:00:00Z');
const dayRun = (daysAfter: number) => new Date(Date.UTC(2026, 10, 2 + daysAfter, 8, 0, 0)).toISOString();

const restaurantIds: string[] = [];

async function tenant(label: string) {
  const [r] = await db.insert(restaurants).values({ name: `g01 ${label} ${RUN}` }).returning();
  const [u] = await db.insert(users).values({ email: `g01-${label}-${RUN}@test.local` }).returning();
  await db.insert(memberships).values({ userId: u!.id, restaurantId: r!.id, role: 'manager' });
  const [s] = await db.insert(suppliers).values({ restaurantId: r!.id, name: `ספק ${label}` }).returning();
  restaurantIds.push(r!.id);
  return { restaurantId: r!.id, supplierId: s!.id, userId: u!.id };
}

async function po(
  t: { restaurantId: string; supplierId: string },
  values: Partial<typeof purchaseOrders.$inferInsert> = {},
) {
  const [row] = await db
    .insert(purchaseOrders)
    .values({ restaurantId: t.restaurantId, supplierId: t.supplierId, status: 'sent', expectedDeliveryAt: EXPECTED, ...values })
    .returning();
  return row!.id;
}

const outboxRows = (restaurantId: string, poId: string) =>
  db
    .select({ key: notificationsOutbox.dedupeKey })
    .from(notificationsOutbox)
    .where(and(eq(notificationsOutbox.restaurantId, restaurantId), eq(notificationsOutbox.relatedEntityId, poId)));

const run = (restaurantId: string, daysAfter: number) =>
  processSupplierDelays(job({ restaurantId, forDate: dayRun(daysAfter) }));

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(async () => {
  for (const id of restaurantIds) await db.delete(restaurants).where(eq(restaurants.id, id));
});

describe('supplier-delays only chases deliveries that never arrived (G-01)', () => {
  it('a sent PO due yesterday WITH a completed receipt → no e-mail, today or tomorrow', async () => {
    const t = await tenant('completed');
    const id = await po(t);
    await db.insert(goodsReceipts).values({ restaurantId: t.restaurantId, poId: id, status: 'completed' });
    await run(t.restaurantId, 1);
    await run(t.restaurantId, 2);
    await run(t.restaurantId, 3);
    expect(await outboxRows(t.restaurantId, id)).toEqual([]);
  });

  it('a partial receipt is terminal → no e-mail (the missing lines are a backorder)', async () => {
    const t = await tenant('partial');
    const id = await po(t);
    await db.insert(goodsReceipts).values({ restaurantId: t.restaurantId, poId: id, status: 'partial' });
    await run(t.restaurantId, 1);
    await run(t.restaurantId, 3);
    expect(await outboxRows(t.restaurantId, id)).toEqual([]);
  });

  it('a receipt still being counted (pending) → no e-mail', async () => {
    const t = await tenant('pending');
    const id = await po(t);
    await db.insert(goodsReceipts).values({ restaurantId: t.restaurantId, poId: id, status: 'pending' });
    await run(t.restaurantId, 1);
    expect(await outboxRows(t.restaurantId, id)).toEqual([]);
  });

  it('a platform PO synced as closed → no e-mail', async () => {
    const t = await tenant('closed');
    const id = await po(t, { status: 'closed', source: 'platform', sourceRef: `zestt-${RUN}` });
    await run(t.restaurantId, 1);
    await run(t.restaurantId, 7);
    expect(await outboxRows(t.restaurantId, id)).toEqual([]);
  });

  it('a delivery that never came → one e-mail on days 1, 3 and 7; nothing on day 2 or 8; re-runs add nothing', async () => {
    const t = await tenant('missing');
    const id = await po(t);
    const after: number[] = [];
    for (let d = 1; d <= 8; d++) {
      await run(t.restaurantId, d);
      if (d === 1) await run(t.restaurantId, 1); // a second run the same day (retry / two workers)
      after.push((await outboxRows(t.restaurantId, id)).length);
    }
    //            d1 d2 d3 d4 d5 d6 d7 d8
    expect(after).toEqual([1, 1, 2, 2, 2, 2, 3, 3]);
    const keys = (await outboxRows(t.restaurantId, id)).map((r) => r.key).sort();
    expect(keys).toEqual(
      ['d1', 'd3', 'd7'].map((step) => `po:${id}:late:${step}:g01-missing-${RUN}@test.local`).sort(),
    );
  });

  it('a PO older than the 14-day lookback is not chased, and other statuses never are', async () => {
    const t = await tenant('old');
    const old = await po(t, { expectedDeliveryAt: new Date('2026-10-14T06:00:00Z') }); // 21 days before day 7
    const partialStatus = await po(t, { status: 'partial' });
    const draft = await po(t, { status: 'draft' });
    const confirmed = await po(t, { status: 'confirmed' });
    await run(t.restaurantId, 7);
    expect(await outboxRows(t.restaurantId, old)).toEqual([]);
    expect(await outboxRows(t.restaurantId, partialStatus)).toEqual([]);
    expect(await outboxRows(t.restaurantId, draft)).toEqual([]);
    expect((await outboxRows(t.restaurantId, confirmed)).length).toBe(1); // confirmed is open: chased (d7)
  });

  it('poDeliveryStateSql agrees with deliveryState() on the seeded POs', async () => {
    const t = await tenant('parity');
    const now = new Date(dayRun(1));
    const cases = [
      await po(t), // late
      await po(t, { expectedDeliveryAt: new Date(dayRun(1)) }), // due today (10:00, now 10:00)
      await po(t, { expectedDeliveryAt: new Date(dayRun(3)) }), // upcoming
      await po(t, { status: 'cancelled' }),
      await po(t, { status: 'closed' }),
    ];
    const withGr = await po(t);
    await db.insert(goodsReceipts).values({ restaurantId: t.restaurantId, poId: withGr, status: 'pending' });
    const rows = await db
      .select({
        id: purchaseOrders.id,
        status: purchaseOrders.status,
        expectedAt: purchaseOrders.expectedDeliveryAt,
        sqlState: poDeliveryStateSql(t.restaurantId, { now, tz: 'Asia/Jerusalem' }),
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.restaurantId, t.restaurantId));
    const states = new Map(rows.map((r) => [r.id, r.sqlState]));
    expect([...cases, withGr].map((id) => states.get(id))).toEqual([
      'late',
      'due_today',
      'upcoming',
      'cancelled',
      'received',
      'in_progress',
    ]);
    for (const r of rows) {
      const pure = deliveryState({
        po: { status: r.status, expectedDeliveryAt: r.expectedAt },
        latestReceipt: r.id === withGr ? { status: 'pending' } : null,
        now,
        tz: 'Asia/Jerusalem',
      });
      expect(r.sqlState, r.id).toBe(pure);
    }
  });
});
