import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, memberships, testDbUrl, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Per-member app language (client-ready S4): the inviter's language choice
 * rides on the invitation, becomes the member's preferred_locale on accept, and
 * survives a role change (updateMemberRole deletes + re-inserts the membership).
 */
const db = createDb(testDbUrl());
let A: Tenant;
let inviteeId: string;

function caller(session: Session) {
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}
const owner = () => caller({ userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'owner' });

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  const [u] = await db
    .insert(users)
    .values({ email: 'english.receiver@locale.test', emailVerified: new Date() })
    .returning();
  inviteeId = u!.id;
});

afterAll(async () => {
  await resetDb(db);
});

async function inviteeLocale() {
  const [row] = await db
    .select({ locale: memberships.preferredLocale, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, inviteeId)));
  return row;
}

describe('team: invitee language', () => {
  it('invite(locale=en) → returns the locale, lists it, and accept copies it onto the membership', async () => {
    const res = await owner().team.invite({
      email: 'English.Receiver@locale.test',
      role: 'receiver',
      locale: 'en',
    });
    expect(res.locale).toBe('en');
    const { invites } = await owner().team.list();
    expect(invites.find((i) => i.email === 'english.receiver@locale.test')?.preferredLocale).toBe('en');

    const resent = await owner().team.resendInvite({
      id: invites.find((i) => i.email === 'english.receiver@locale.test')!.id,
    });
    expect(resent.locale).toBe('en');

    const accepted = await caller({ userId: inviteeId, restaurantId: null, role: null }).team.acceptInvite({
      token: resent.rawToken,
    });
    expect(accepted.preferredLocale).toBe('en');
    expect(await inviteeLocale()).toEqual({ locale: 'en', role: 'receiver' });
  });

  it('updateMemberRole keeps the member language', async () => {
    await owner().team.updateMemberRole({ userId: inviteeId, role: 'chef' });
    expect(await inviteeLocale()).toEqual({ locale: 'en', role: 'chef' });
  });

  it('a manager can switch the member back to Hebrew; the member can change it themselves', async () => {
    await caller({ userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'manager' }).team.setMemberLocale({
      userId: inviteeId,
      locale: 'he',
    });
    expect((await inviteeLocale())?.locale).toBe('he');
    const self = caller({ userId: inviteeId, restaurantId: A.restaurantId, role: 'chef' });
    await self.settings.setMyLocale({ locale: 'en' });
    expect(await self.settings.myLocale()).toEqual({ locale: 'en' });
  });

  it('invite without a locale stores NULL (Hebrew default, no forced language)', async () => {
    const res = await owner().team.invite({ email: 'nolocale@locale.test', role: 'manager' });
    expect(res.locale).toBeNull();
  });
});
