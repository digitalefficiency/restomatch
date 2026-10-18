import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, notificationsOutbox, purchaseOrders, suppliers } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { enqueueNotification } from '../notifications/outbox';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Real-Postgres regression for the outbox dedupe (the mocked
 * outbox-dedupe.test.ts could not see it): notifications_dedupe_key_unique is a
 * PARTIAL unique index, and `ON CONFLICT (dedupe_key)` without its predicate
 * raised "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification" — breaking the end-of-day report, order reminders, supplier
 * delay alerts and placeOrder by email/WhatsApp.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(async () => {
  await resetDb(db);
});

describe('enqueueNotification on the real partial unique index', () => {
  it('a keyed enqueue inserts once; the duplicate is deduped to the same row', async () => {
    const payload = {
      restaurantId: A.restaurantId,
      channel: 'email' as const,
      target: 'owner@example.test',
      subject: 'EOD',
      body: 'report',
      dedupeKey: `eod-report:${A.restaurantId}:2026-10-18:owner@example.test`,
    };
    const first = await enqueueNotification(db, payload);
    const second = await enqueueNotification(db, payload);
    expect(first.deduped).toBe(false);
    expect(second).toEqual({ id: first.id, deduped: true });
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.target, 'owner@example.test'));
    expect(rows).toHaveLength(1);
  });

  it('unkeyed enqueues are never deduped', async () => {
    const payload = { restaurantId: A.restaurantId, channel: 'email' as const, target: 'x@example.test', body: 'b' };
    await enqueueNotification(db, payload);
    await enqueueNotification(db, payload);
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.target, 'x@example.test'));
    expect(rows).toHaveLength(2);
  });
});

describe('orders.placeOrder by email', () => {
  it('queues exactly one order document for the supplier and marks the PO sent', async () => {
    await db.update(suppliers).set({ contactEmail: 'orders@supplier.test' }).where(eq(suppliers.id, A.supplierId));
    const { poId } = await callerFor(A).orders.createDraft({
      supplierId: A.supplierId,
      lines: [{ rawDescription: 'עגבניות', qty: 2, unit: 'ק״ג', unitPriceExpected: 10 }],
    });
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });

    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, poId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'email', target: 'orders@supplier.test', dedupeKey: `po:${poId}:placed`, status: 'queued' });
    const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    expect(po?.status).toBe('sent');
  });
});
