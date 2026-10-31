/**
 * W2-04 §5.6 (functional-flows-03, deep-fix class 14): an escalation is not a
 * silent hand-off. Audit with provenance, one outbox row per owner at a
 * concrete address (never `role:`), with ₪ + supplier + a branch-aware link;
 * the escalator keeps seeing the row as "waiting on the owner".
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, ne, memberships, notificationsOutbox, sql, testDbUrl, users } from '@restomatch/db';
import { resetDb } from './fixtures';
import { callerAs, seedDesk, type Desk } from './approvals-desk.fixtures';
import { approvalsGoLink } from '../routers/approvals';

const db = createDb(testDbUrl());
let T: Desk;
let secondOwner: string;

beforeEach(async () => {
  await resetDb(db);
  T = await seedDesk(db, 'ES');
  const [u] = await db.insert(users).values({ email: 'owner2-es@desk.test', name: 'שותפה', emailVerified: new Date() }).returning();
  secondOwner = u!.id;
  await db.insert(memberships).values({ userId: secondOwner, restaurantId: T.restaurantId, role: 'owner' });
});
afterAll(async () => {
  await resetDb(db);
});

describe('approvals.escalate', () => {
  it('writes the audit with provenance and one queued outbox row per owner at a concrete address', async () => {
    await callerAs(db, T, 'manager').approvals.escalate({ discrepancyId: T.discrepancyId, note: 'מחיר חריג, צריך את הבעלים' });

    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, 'discrepancy.escalated'));
    expect(a).toMatchObject({ userId: T.users.manager, entityId: T.discrepancyId });
    expect(a!.after).toMatchObject({ decision: 'escalated', fromRole: 'manager', escalatedBy: T.users.manager, amountAgorot: 10_000 });

    const rows = await db.select().from(notificationsOutbox).where(and(eq(notificationsOutbox.restaurantId, T.restaurantId), eq(notificationsOutbox.relatedEntityType, 'discrepancy')));
    const owners = await db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.restaurantId, T.restaurantId), eq(memberships.role, 'owner')));
    expect(owners.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((r) => r.target).sort()).toEqual(owners.map((o) => o.email).sort());
    for (const r of rows) {
      expect(r).toMatchObject({ channel: 'email', status: 'queued', relatedEntityType: 'discrepancy', relatedEntityId: T.discrepancyId });
      expect(r.body).toContain(T.supplierName);
      expect(r.body).toMatch(/₪/);
      expect(r.body).toContain(approvalsGoLink(T.restaurantId, T.invoiceId));
      expect(r.body).toContain('צריך את הבעלים');
    }
    const [{ c }] = (await db.execute(
      sql`SELECT count(*)::int AS c FROM notifications_outbox WHERE target LIKE 'role:%'`,
    )) as unknown as Array<{ c: number }>;
    expect(c).toBe(0);
  });

  it('the go-link carries the restaurant and the invoice', () => {
    const link = approvalsGoLink('r-1', 'inv-9', 'https://x.test');
    const u = new URL(link);
    expect(u.pathname).toBe('/dashboard/go');
    expect(u.searchParams.get('r')).toBe('r-1');
    expect(u.searchParams.get('to')).toBe('/dashboard/approvals?invoice=inv-9');
    expect(new URL(approvalsGoLink('r-1', null, 'https://x.test')).searchParams.get('to')).toBe('/dashboard/approvals');
  });

  it("the escalator keeps seeing it under scope 'all' (waitingOn owner, canAct false) and in the others lane", async () => {
    const mgr = callerAs(db, T, 'manager');
    await mgr.approvals.escalate({ discrepancyId: T.discrepancyId });
    expect(await mgr.approvals.myQueue()).toEqual([]);
    const all = await mgr.approvals.myQueue({ scope: 'all' });
    expect(all.map((r) => [r.id, r.waitingOn, r.canAct])).toEqual([[T.discrepancyId, 'owner', false]]);
    const sum = await mgr.approvals.queueSummary();
    expect(sum.count).toBe(0);
    expect(sum.others.byRole).toEqual([{ role: 'owner', count: 1, amountIls: 100 }]);
    // The owner now decides it.
    const own = await callerAs(db, T, 'owner').approvals.myQueue();
    expect(own.map((r) => [r.id, r.canAct])).toEqual([[T.discrepancyId, true]]);
  });

  it('an owner escalating does not notify themself', async () => {
    // Leave the escalating owner as the only owner.
    await db
      .update(memberships)
      .set({ role: 'manager' })
      .where(and(eq(memberships.restaurantId, T.restaurantId), eq(memberships.role, 'owner'), ne(memberships.userId, T.ownerUserId)));
    await callerAs(db, T, 'owner').approvals.escalate({ discrepancyId: T.discrepancyId });
    const rows = await db.select().from(notificationsOutbox).where(and(eq(notificationsOutbox.restaurantId, T.restaurantId), eq(notificationsOutbox.relatedEntityType, 'discrepancy')));
    expect(rows).toHaveLength(0);
  });
});
