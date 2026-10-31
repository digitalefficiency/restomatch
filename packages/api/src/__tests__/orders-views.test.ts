import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, goodsReceipts, purchaseOrders } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { ORDER_VIEWS } from '../orders/views';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-06 §5.6 — queue views: each tab's count equals the rows it lists; tenant-isolated. */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const DAY = 86_400_000;
const callerFor = (t: Tenant, role: Session['role'] = 'manager') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

async function po(t: Tenant, status: 'draft' | 'sent' | 'cancelled', inDays: number | null) {
  const [row] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      status,
      source: 'manual',
      expectedDeliveryAt: inDays === null ? null : new Date(Date.now() + inDays * DAY),
    })
    .returning({ id: purchaseOrders.id });
  return row!.id;
}

describe('orders.viewCounts / orders.list({ view })', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
    await po(A, 'draft', null);
    await po(A, 'draft', 2);
    await po(A, 'sent', -3); // late
    await po(A, 'sent', 3); // this week
    await po(A, 'sent', 20); // later
    await po(A, 'cancelled', -3); // never counted
    const received = await po(A, 'sent', -2); // late but received → not late
    await db.insert(goodsReceipts).values({ restaurantId: A.restaurantId, poId: received, receivedBy: A.ownerUserId, status: 'completed' });
    for (let i = 0; i < 4; i++) await po(B, 'draft', -1); // B's noise
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('each count equals the rows its view lists', async () => {
    const c = callerFor(A);
    const counts = await c.orders.viewCounts();
    for (const view of ORDER_VIEWS) {
      const rows = await c.orders.list({ view, limit: 100 });
      expect(rows.length, view).toBe(counts[view]);
    }
    expect(counts.drafts).toBe(2);
    // The fixture PO (sent today, with a pending receipt) counts as today, not late.
    expect(counts.late).toBe(1);
    expect(counts.action).toBe(counts.drafts + counts.late);
    expect(counts.week).toBeGreaterThanOrEqual(1);
  });

  it("A's counts never include B's orders (and the reverse)", async () => {
    const b = await callerFor(B).orders.viewCounts();
    expect(b.drafts).toBe(4);
    const a = await callerFor(A).orders.viewCounts();
    expect(a.drafts).toBe(2);
  });
});
