import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
  memberships,
  notificationsOutbox,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  users,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { MockWhatsAppNotifier } from '../notifications';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(notificationsOutbox);
  await db.delete(auditLog);
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

interface Scenario {
  restaurantId: string;
  ownerId: string;
  managerId: string;
  bookkeeperId: string;
  matchRunId: string;
  discrepancyOwnerId: string;
  discrepancyManagerId: string;
}

async function seed(): Promise<Scenario> {
  const [r] = await db.insert(restaurants).values({ name: 'Approvals Bistro' }).returning();
  const owner = await db.insert(users).values({ email: 'owner@a.test' }).returning();
  const manager = await db.insert(users).values({ email: 'mgr@a.test' }).returning();
  const bookkeeper = await db.insert(users).values({ email: 'bk@a.test' }).returning();
  await db.insert(memberships).values([
    { userId: owner[0]!.id, restaurantId: r!.id, role: 'owner' },
    { userId: manager[0]!.id, restaurantId: r!.id, role: 'manager' },
    { userId: bookkeeper[0]!.id, restaurantId: r!.id, role: 'bookkeeper' },
  ]);

  const [mr] = await db
    .insert(matchRuns)
    .values({ restaurantId: r!.id, overallStatus: 'major', totalDiscrepancyAmount: '500' })
    .returning();

  const [dOwner] = await db
    .insert(discrepancies)
    .values({
      restaurantId: r!.id,
      matchRunId: mr!.id,
      type: 'PRICE_HIGHER',
      severity: 'block',
      deltaAmount: '300',
      requiresRole: 'owner',
      resolutionStatus: 'open',
    })
    .returning();

  const [dManager] = await db
    .insert(discrepancies)
    .values({
      restaurantId: r!.id,
      matchRunId: mr!.id,
      type: 'QTY_OVER',
      severity: 'warn',
      deltaAmount: '80',
      requiresRole: 'manager',
      resolutionStatus: 'open',
    })
    .returning();

  return {
    restaurantId: r!.id,
    ownerId: owner[0]!.id,
    managerId: manager[0]!.id,
    bookkeeperId: bookkeeper[0]!.id,
    matchRunId: mr!.id,
    discrepancyOwnerId: dOwner!.id,
    discrepancyManagerId: dManager!.id,
  };
}

function caller(session: { userId: string; restaurantId: string; role: 'owner' | 'manager' | 'bookkeeper' }) {
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(resetDb);
afterAll(resetDb);

describe('approvals.myQueue', () => {
  it('manager sees only manager-routed discrepancies', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.managerId,
      restaurantId: s.restaurantId,
      role: 'manager',
    }).approvals.myQueue();
    expect(queue.map((q) => q.id)).toEqual([s.discrepancyManagerId]);
  });

  it('owner sees both manager- and owner-routed', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.ownerId,
      restaurantId: s.restaurantId,
      role: 'owner',
    }).approvals.myQueue();
    expect(queue.map((q) => q.id).sort()).toEqual(
      [s.discrepancyOwnerId, s.discrepancyManagerId].sort(),
    );
  });

  it('bookkeeper sees bookkeeper-routed only (none here)', async () => {
    const s = await seed();
    const queue = await caller({
      userId: s.bookkeeperId,
      restaurantId: s.restaurantId,
      role: 'bookkeeper',
    }).approvals.myQueue();
    expect(queue).toEqual([]);
  });

  it('respects multi-tenant isolation', async () => {
    const s = await seed();
    const [other] = await db.insert(restaurants).values({ name: 'Other' }).returning();
    const [u] = await db.insert(users).values({ email: 'mgr@other.test' }).returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, restaurantId: other!.id, role: 'manager' });
    const queue = await caller({
      userId: u!.id,
      restaurantId: other!.id,
      role: 'manager',
    }).approvals.myQueue();
    expect(queue).toEqual([]);
  });
});

describe('approvals.approve / reject / escalate', () => {
  it('manager can approve manager-routed discrepancy and writes audit log', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.approve({
      discrepancyId: s.discrepancyManagerId,
      note: 'בדקתי, בסדר',
    });
    expect(updated.resolutionStatus).toBe('accepted');

    const audits = await db.select().from(auditLog);
    const matching = audits.find((a) => a.entityId === s.discrepancyManagerId);
    expect(matching?.action).toBe('discrepancy.approved');
  });

  it('manager cannot approve owner-only discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await expect(
      c.approvals.approve({ discrepancyId: s.discrepancyOwnerId }),
    ).rejects.toThrow(/role manager/);
  });

  it('owner can approve owner-routed discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    const updated = await c.approvals.approve({ discrepancyId: s.discrepancyOwnerId });
    expect(updated.resolutionStatus).toBe('accepted');
  });

  it('reject requires a reason', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await expect(
      c.approvals.reject({ discrepancyId: s.discrepancyManagerId, reason: '' }),
    ).rejects.toThrow();
  });

  it('reject sets resolution to rejected with note', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.reject({
      discrepancyId: s.discrepancyManagerId,
      reason: 'ספק טען שזה מחיר נכון לעונה',
    });
    expect(updated.resolutionStatus).toBe('rejected');
    expect(updated.resolutionNote).toBe('ספק טען שזה מחיר נכון לעונה');
  });

  it('escalate moves required_role to owner and logs', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.escalate({
      discrepancyId: s.discrepancyManagerId,
      note: 'צריך החלטה גבוהה יותר',
    });
    expect(updated.resolutionStatus).toBe('escalated');
    expect(updated.requiresRole).toBe('owner');
  });

  it('approve persists actor and timestamp', async () => {
    const s = await seed();
    const before = new Date();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    const updated = await c.approvals.approve({ discrepancyId: s.discrepancyManagerId });
    expect(updated.resolvedBy).toBe(s.managerId);
    expect(updated.resolvedAt).toBeInstanceOf(Date);
    expect(updated.resolvedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe('approvals.history', () => {
  it('returns the audit log entries for a discrepancy', async () => {
    const s = await seed();
    const c = caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' });
    await c.approvals.approve({ discrepancyId: s.discrepancyManagerId, note: 'note A' });

    const history = await c.approvals.history({ discrepancyId: s.discrepancyManagerId });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.action).toBe('discrepancy.approved');
  });
});

describe('MockWhatsAppNotifier', () => {
  it('writes to outbox and marks sent', async () => {
    const s = await seed();
    const notifier = new MockWhatsAppNotifier();
    const result = await notifier.send(db, {
      restaurantId: s.restaurantId,
      channel: 'whatsapp',
      target: '+972-50-1234567',
      subject: 'חריגה חמורה',
      body: 'נדרש אישור שלך לחשבונית',
      relatedEntityType: 'discrepancy',
      relatedEntityId: s.discrepancyOwnerId,
    });
    expect(result.ok).toBe(true);
    expect(result.externalId).toMatch(/^wa-mock-/);

    const rows = await db.select().from(notificationsOutbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe('whatsapp');
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.relatedEntityId).toBe(s.discrepancyOwnerId);
  });
});
