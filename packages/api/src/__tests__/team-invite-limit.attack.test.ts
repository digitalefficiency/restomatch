import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, invitations, sql, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { TEAM_INVITE_LIMIT } from '../routers/team';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-07b follow-up (security review, /join): a per-owner cap on invite churn at
 * the tRPC layer — invite, resend and revoke share TEAM_INVITE_LIMIT per inviting
 * user, so a revoke → re-invite loop cannot spam a mailbox or probe /join.
 * Add-only attack suite.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function caller(session: Session) {
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
const ownerOf = (t: Tenant) => caller({ userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' });

beforeAll(async () => {
  await resetDb(db);
  await db.execute(sql`delete from rate_limit_counters where key like ${`${TEAM_INVITE_LIMIT.prefix}:%`}`);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

afterAll(async () => {
  await db.execute(sql`delete from rate_limit_counters where key like ${`${TEAM_INVITE_LIMIT.prefix}:%`}`);
  await resetDb(db);
});

describe('team: per-owner invite limit', () => {
  const pendingId = async (email: string) => {
    const [inv] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(eq(invitations.restaurantId, A.restaurantId), eq(invitations.email, email), eq(invitations.status, 'pending')),
      );
    return inv?.id;
  };

  it(`a revoke → re-invite loop is cut off after ${TEAM_INVITE_LIMIT.limit} invite e-mails per hour; revoke itself is free`, async () => {
    const owner = ownerOf(A);
    let invites = 0;
    let refused: unknown = null;
    for (let i = 0; i < TEAM_INVITE_LIMIT.limit + 2 && !refused; i += 1) {
      try {
        await owner.team.invite({ email: 'victim@mailbox.test', role: 'receiver' });
        invites += 1;
        await owner.team.revokeInvite({ id: (await pendingId('victim@mailbox.test'))! });
      } catch (e) {
        refused = e;
      }
    }
    expect(refused).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(invites).toBe(TEAM_INVITE_LIMIT.limit);
    // resend shares the same budget
    await expect(owner.team.resendInvite({ id: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('review finding 2: with the budget used up, the owner can still revoke a live invite', async () => {
    // a live owner-role invite to a mistyped address, made directly (the budget is spent)
    await db.insert(invitations).values({
      restaurantId: A.restaurantId,
      email: 'owner@mistyped.test',
      role: 'owner',
      tokenHash: 'f'.repeat(64),
      invitedByUserId: A.ownerUserId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    const owner = ownerOf(A);
    await expect(owner.team.invite({ email: 'another@mailbox.test', role: 'chef' })).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    const id = await pendingId('owner@mistyped.test');
    await expect(owner.team.revokeInvite({ id: id! })).resolves.toBeTruthy();
    expect(await pendingId('owner@mistyped.test')).toBeUndefined();
  });

  it("one owner's budget never blocks another owner", async () => {
    await expect(ownerOf(B).team.invite({ email: 'someone@mailbox.test', role: 'chef' })).resolves.toBeTruthy();
  });
});
