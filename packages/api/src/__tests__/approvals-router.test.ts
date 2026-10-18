import { testDbUrl } from '@restomatch/db';
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
  testDbUrl();
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

  it('hides the ₪0 QTY_SHORT twin of a short delivery billed in full', async () => {
    const s = await seed();
    const [zero] = await db
      .insert(discrepancies)
      .values({
        matchRunId: s.matchRunId,
        restaurantId: s.restaurantId,
        type: 'QTY_SHORT',
        severity: 'warn',
        deltaAmount: '0',
        requiresRole: 'manager',
        resolutionStatus: 'open',
      })
      .returning();
    const [real] = await db
      .insert(discrepancies)
      .values({
        matchRunId: s.matchRunId,
        restaurantId: s.restaurantId,
        type: 'QTY_SHORT',
        severity: 'warn',
        deltaAmount: '16',
        requiresRole: 'manager',
        resolutionStatus: 'open',
      })
      .returning();
    const queue = await caller({ userId: s.managerId, restaurantId: s.restaurantId, role: 'manager' }).approvals.myQueue();
    const ids = queue.map((q) => q.id);
    expect(ids).not.toContain(zero!.id);
    expect(ids).toContain(real!.id);
    expect(ids).toContain(s.discrepancyManagerId);
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

describe('approvals role deadlock (DUPLICATE_INVOICE → bookkeeper)', () => {
  async function seedBookkeeperItem(s: Scenario) {
    const [d] = await db
      .insert(discrepancies)
      .values({
        restaurantId: s.restaurantId,
        matchRunId: s.matchRunId,
        type: 'DUPLICATE_INVOICE',
        severity: 'block',
        deltaAmount: '117',
        requiresRole: 'bookkeeper',
        resolutionStatus: 'open',
      })
      .returning();
    return d!.id;
  }
  const bk = (s: Scenario) =>
    caller({ userId: s.bookkeeperId, restaurantId: s.restaurantId, role: 'bookkeeper' });

  it('the bookkeeper sees AND can reject a duplicate routed to them', async () => {
    const s = await seed();
    const id = await seedBookkeeperItem(s);
    const queue = await bk(s).approvals.myQueue();
    expect(queue.map((q) => q.id)).toEqual([id]);
    const updated = await bk(s).approvals.reject({ discrepancyId: id, reason: 'כפולה — לא לשלם' });
    expect(updated.resolutionStatus).toBe('rejected');
  });

  it('the bookkeeper can approve and escalate bookkeeper items', async () => {
    const s = await seed();
    const a = await seedBookkeeperItem(s);
    const b = await seedBookkeeperItem(s);
    expect((await bk(s).approvals.approve({ discrepancyId: a })).resolutionStatus).toBe('accepted');
    const esc = await bk(s).approvals.escalate({ discrepancyId: b });
    expect(esc.resolutionStatus).toBe('escalated');
    expect(esc.requiresRole).toBe('owner');
  });

  it('the bookkeeper still cannot act on manager/owner items', async () => {
    const s = await seed();
    await expect(
      bk(s).approvals.approve({ discrepancyId: s.discrepancyManagerId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      bk(s).approvals.reject({ discrepancyId: s.discrepancyOwnerId, reason: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a receiver cannot decide anything', async () => {
    const s = await seed();
    const [rcv] = await db.insert(users).values({ email: 'rcv@a.test' }).returning();
    await db
      .insert(memberships)
      .values({ userId: rcv!.id, restaurantId: s.restaurantId, role: 'receiver' });
    const r = appRouter.createCaller({
      db,
      session: { userId: rcv!.id, restaurantId: s.restaurantId, role: 'receiver' },
    } as AppContext);
    await expect(r.approvals.approve({ discrepancyId: s.discrepancyManagerId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('approvals.myQueue view filters', () => {
  it('filters by discrepancy type and severity', async () => {
    const s = await seed();
    const owner = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    expect((await owner.approvals.myQueue({ types: ['QTY_OVER'] })).map((q) => q.id)).toEqual([s.discrepancyManagerId]);
    expect((await owner.approvals.myQueue({ severities: ['block'] })).map((q) => q.id)).toEqual([s.discrepancyOwnerId]);
    expect(await owner.approvals.myQueue({ types: ['VAT_MISMATCH'] })).toEqual([]);
  });

  it('rejects unknown filter values', async () => {
    const s = await seed();
    const owner = caller({ userId: s.ownerId, restaurantId: s.restaurantId, role: 'owner' });
    // @ts-expect-error — not a severity
    await expect(owner.approvals.myQueue({ severities: ['critical'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(owner.approvals.myQueue({ supplierIds: ['nope'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
