import { afterAll, describe, expect, it } from 'vitest';
import { and, auditLog, eq, invitations } from '@restomatch/db';
import { cleanup, makeInvite, makeRestaurant, makeUser, membershipsOf, ownerDb, uniqueEmail } from '../../join/__tests__/helpers';
import { acceptPendingInvite, pendingInvitesFor } from '../pendingInvites';

afterAll(cleanup);

describe('/onboarding pending invites (W3-07b)', () => {
  it('lists only pending, unexpired invites addressed to the session user', async () => {
    const rid = await makeRestaurant('הזיתים');
    const inviter = await makeUser(uniqueEmail('own'), 'רום');
    const me = uniqueEmail('me');
    const uid = await makeUser(me, null);
    const mine = await makeInvite({ restaurantId: rid, email: me, role: 'chef', invitedBy: inviter });
    await makeInvite({ restaurantId: await makeRestaurant(), email: me, status: 'revoked' });
    await makeInvite({ restaurantId: await makeRestaurant(), email: me, expiresInMs: -1000 });
    await makeInvite({ restaurantId: rid, email: uniqueEmail('other') });
    const list = await pendingInvitesFor(uid);
    expect(list).toEqual([{ id: mine.id, restaurantName: 'הזיתים', role: 'chef', inviterName: 'רום' }]);
  });

  it('accepts by id for the addressed user: membership with the invite role, audited, single-use', async () => {
    const rid = await makeRestaurant();
    const me = uniqueEmail('acc');
    const uid = await makeUser(me);
    const inv = await makeInvite({ restaurantId: rid, email: me, role: 'bookkeeper' });
    expect(await acceptPendingInvite(uid, inv.id)).toEqual({ ok: true, restaurantId: rid });
    const ms = await membershipsOf(uid);
    expect(ms.map((m) => [m.restaurantId, m.role])).toEqual([[rid, 'bookkeeper']]);
    const audits = await ownerDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, inv.id), eq(auditLog.action, 'team.invite_accepted')));
    expect(audits).toHaveLength(1);
    expect(await acceptPendingInvite(uid, inv.id)).toEqual({ ok: false, reason: 'used' });
  });

  it('attack: another user cannot accept an invite addressed to someone else', async () => {
    const rid = await makeRestaurant();
    const victim = uniqueEmail('victim');
    const attacker = await makeUser(uniqueEmail('attacker'));
    const inv = await makeInvite({ restaurantId: rid, email: victim, role: 'owner' });
    expect(await acceptPendingInvite(attacker, inv.id)).toEqual({ ok: false, reason: 'wrongEmail' });
    expect(await membershipsOf(attacker)).toHaveLength(0);
    const [row] = await ownerDb.select().from(invitations).where(eq(invitations.id, inv.id));
    expect(row?.status).toBe('pending');
    expect(await acceptPendingInvite(attacker, 'not-a-uuid')).toEqual({ ok: false, reason: 'notFound' });
  });

  it('expired and revoked invites are refused', async () => {
    const me = uniqueEmail('late');
    const uid = await makeUser(me);
    const old = await makeInvite({ restaurantId: await makeRestaurant(), email: me, expiresInMs: -1000 });
    const rev = await makeInvite({ restaurantId: await makeRestaurant(), email: me, status: 'revoked' });
    expect(await acceptPendingInvite(uid, old.id)).toEqual({ ok: false, reason: 'expired' });
    expect(await acceptPendingInvite(uid, rev.id)).toEqual({ ok: false, reason: 'used' });
    expect(await membershipsOf(uid)).toHaveLength(0);
  });
});
