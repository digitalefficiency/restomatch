/**
 * W2-14 team admin: staged role change (CONFLICT on a stale role, naming who
 * changed it), ownership transfer (owner only, active member only, atomic,
 * audited), last-owner guard, and one login per person.
 */
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, invitations, memberships, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());

let A: Tenant;
let memberId: string;

function callerAs(userId: string, role: Session['role']) {
  const session: Session = { userId, restaurantId: A.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
const owner = () => callerAs(A.ownerUserId, 'owner');

async function rolesOf(userId: string) {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, userId)));
  return rows.map((r) => r.role).sort();
}

describe('team admin (W2-14)', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    const [u] = await db
      .insert(users)
      .values({ email: 'dana@team-admin.test', name: 'Dana', emailVerified: new Date() })
      .returning();
    memberId = u!.id;
  });
  afterAll(async () => {
    await resetDb(db);
  });
  beforeEach(async () => {
    await db.delete(memberships).where(eq(memberships.restaurantId, A.restaurantId));
    await db.insert(memberships).values([
      { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' },
      { userId: memberId, restaurantId: A.restaurantId, role: 'manager' },
    ]);
  });

  it('a staged change from the current role succeeds', async () => {
    await owner().team.updateMemberRole({ userId: memberId, role: 'bookkeeper', expectedRole: 'manager' });
    expect(await rolesOf(memberId)).toEqual(['bookkeeper']);
  });

  it('a stale staged change → CONFLICT naming who changed it, nothing written', async () => {
    await owner().team.updateMemberRole({ userId: memberId, role: 'chef' }); // someone else's change
    await expect(
      owner().team.updateMemberRole({ userId: memberId, role: 'bookkeeper', expectedRole: 'manager' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('Owner A') });
    expect(await rolesOf(memberId)).toEqual(['chef']);
  });

  it('the last owner cannot demote themselves', async () => {
    await expect(
      owner().team.updateMemberRole({ userId: A.ownerUserId, role: 'manager', expectedRole: 'owner' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('transferOwnership: target becomes owner, caller takes the new role, one audit row', async () => {
    await db.delete(auditLog).where(eq(auditLog.restaurantId, A.restaurantId));
    await owner().team.transferOwnership({ toUserId: memberId, myNewRole: 'manager' });
    expect(await rolesOf(memberId)).toEqual(['owner']);
    expect(await rolesOf(A.ownerUserId)).toEqual(['manager']);
    const audits = await db
      .select({ action: auditLog.action, entityId: auditLog.entityId, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'team.ownership_transferred')));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityId).toBe(memberId);
    expect(audits[0]?.after).toEqual({ to: { role: 'owner' }, from: { role: 'manager' } });
  });

  it('transferOwnership with myNewRole=owner leaves two owners', async () => {
    await owner().team.transferOwnership({ toUserId: memberId, myNewRole: 'owner' });
    expect(await rolesOf(memberId)).toEqual(['owner']);
    expect(await rolesOf(A.ownerUserId)).toEqual(['owner']);
  });

  it('transferOwnership to a non-member → NOT_FOUND and nothing changes (atomic)', async () => {
    const [stranger] = await db
      .insert(users)
      .values({ email: `stranger-${Date.now()}@team-admin.test`, emailVerified: new Date() })
      .returning();
    await expect(
      owner().team.transferOwnership({ toUserId: stranger!.id, myNewRole: 'manager' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await rolesOf(A.ownerUserId)).toEqual(['owner']);
  });

  it('transferOwnership to yourself is refused', async () => {
    await expect(
      owner().team.transferOwnership({ toUserId: A.ownerUserId, myNewRole: 'manager' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('transferOwnership is owner only (a manager is FORBIDDEN)', async () => {
    await expect(
      callerAs(memberId, 'manager').team.transferOwnership({ toUserId: A.ownerUserId, myNewRole: 'manager' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an invite always targets exactly one e-mail (one login per person, no shared account)', async () => {
    const count = async () =>
      (await db.select({ id: invitations.id }).from(invitations).where(eq(invitations.restaurantId, A.restaurantId))).length;
    const before = await count();
    await expect(
      owner().team.invite({ email: 'a@x.test, b@x.test', role: 'receiver' } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await count()).toBe(before);
  });
});
