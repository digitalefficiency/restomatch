import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, invitations, memberships, testDbUrl, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-07b · owner decision I3: the bookkeeper READS the team (names + roles
 * only) and every team write stays FORBIDDEN for her. Add-only attack suite.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let bookkeeperId: string;

function caller(session: Session) {
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
const owner = () => caller({ userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' });
const bookkeeper = () => caller({ userId: bookkeeperId, restaurantId: A.restaurantId, role: 'bookkeeper' });

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  const [u] = await db
    .insert(users)
    .values({ email: 'books@bookkeeper.test', name: 'רואת החשבון', emailVerified: new Date() })
    .returning();
  bookkeeperId = u!.id;
  await db.insert(memberships).values({ userId: bookkeeperId, restaurantId: A.restaurantId, role: 'bookkeeper' });
  await owner().team.invite({ email: 'pending.chef@bookkeeper.test', role: 'chef' });
});

afterAll(async () => {
  await resetDb(db);
});

describe('team: bookkeeper read tier (I3)', () => {
  it('lists names and roles of her own team only — no e-mails, languages or invites', async () => {
    const { members, invites } = await bookkeeper().team.list();
    expect(members.length).toBeGreaterThanOrEqual(2);
    expect(members.every((m) => m.email === '' && m.preferredLocale === null)).toBe(true);
    expect(members.map((m) => m.role)).toEqual(expect.arrayContaining(['owner', 'bookkeeper']));
    expect(invites).toEqual([]);
    // never another tenant's people
    const bOwner = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.restaurantId, B.restaurantId));
    expect(members.some((m) => bOwner.some((b) => b.userId === m.userId))).toBe(false);
  });

  it('the owner still sees e-mails and pending invites', async () => {
    const { members, invites } = await owner().team.list();
    expect(members.every((m) => m.email.length > 0)).toBe(true);
    expect(invites.map((i) => i.email)).toContain('pending.chef@bookkeeper.test');
  });

  it('every team write is FORBIDDEN for the bookkeeper', async () => {
    const [inv] = await db.select({ id: invitations.id }).from(invitations).where(eq(invitations.restaurantId, A.restaurantId));
    const forbidden = { code: 'FORBIDDEN' };
    await expect(bookkeeper().team.invite({ email: 'x@bookkeeper.test', role: 'owner' })).rejects.toMatchObject(forbidden);
    await expect(bookkeeper().team.resendInvite({ id: inv!.id })).rejects.toMatchObject(forbidden);
    await expect(bookkeeper().team.revokeInvite({ id: inv!.id })).rejects.toMatchObject(forbidden);
    await expect(bookkeeper().team.updateMemberRole({ userId: bookkeeperId, role: 'owner' })).rejects.toMatchObject(forbidden);
    await expect(bookkeeper().team.removeMember({ userId: A.ownerUserId })).rejects.toMatchObject(forbidden);
    await expect(bookkeeper().team.setMemberLocale({ userId: A.ownerUserId, locale: 'en' })).rejects.toMatchObject(forbidden);
    const [me] = await db.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, bookkeeperId));
    expect(me?.role).toBe('bookkeeper');
  });

  it('receiver and chef still cannot read the team', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(
        caller({ userId: A.ownerUserId, restaurantId: A.restaurantId, role }).team.list(),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
