import { afterAll, describe, expect, it } from 'vitest';
import { eq, invitations, verificationTokens } from '@restomatch/db';
import { authorizeCredentials } from '@/lib/passwords';
import {
  JOIN_CODE_MAX_ATTEMPTS,
  JOIN_CODE_TTL_MS,
  cleanName,
  completeJoin,
  issueJoinCode,
  loadInvite,
  maskEmail,
  stateOf,
} from '../_lib/joinFlow';
import { cleanup, makeInvite, makeRestaurant, makeUser, ownerDb, uniqueEmail, userByEmail } from './helpers';

const PASSWORD = 'correct horse battery 42';

afterAll(cleanup);

describe('pure helpers', () => {
  it('maskEmail keeps first/last letter and the domain', () => {
    expect(maskEmail('dana@example.com')).toBe('d•••a@example.com');
    expect(maskEmail('ab@x.co')).toBe('a•••@x.co');
  });
  it('stateOf', () => {
    const future = new Date(Date.now() + 1000);
    expect(stateOf(null)).toBe('notFound');
    expect(stateOf({ status: 'pending', expiresAt: future })).toBe('valid');
    expect(stateOf({ status: 'pending', expiresAt: new Date(Date.now() - 1) })).toBe('expired');
    expect(stateOf({ status: 'accepted', expiresAt: future })).toBe('used');
    expect(stateOf({ status: 'revoked', expiresAt: future })).toBe('used');
  });
  it('cleanName trims, bounds and rejects control characters', () => {
    expect(cleanName('  דנה   כהן ')).toBe('דנה כהן');
    expect(cleanName('a')).toBeNull();
    expect(cleanName('x'.repeat(81))).toBeNull();
    expect(cleanName('ab\u0007c')).toBeNull();
    expect(cleanName(42)).toBeNull();
  });
});

describe('join flow (DB)', () => {
  it('loadInvite shows restaurant, role, inviter and a masked address for a valid token', async () => {
    const rid = await makeRestaurant('ציקטי בדיקה');
    const inviter = await makeUser(uniqueEmail('owner'), 'רום');
    const email = uniqueEmail('dana');
    const { token } = await makeInvite({ restaurantId: rid, email, role: 'manager', invitedBy: inviter });
    const view = await loadInvite(token);
    expect(view).toMatchObject({ state: 'valid', restaurantName: 'ציקטי בדיקה', role: 'manager', inviterName: 'רום' });
    expect(view.maskedEmail).not.toBe(email);
    expect(view.maskedEmail?.endsWith('@restaurant.example')).toBe(true);
  });

  it('happy path: code → user + password, the code is spent', async () => {
    const rid = await makeRestaurant();
    const email = uniqueEmail('happy');
    const { token, id } = await makeInvite({ restaurantId: rid, email });
    const issued = await issueJoinCode(token);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.email).toBe(email);
    // never stored in clear
    const [row] = await ownerDb.select().from(verificationTokens).where(eq(verificationTokens.identifier, `join:${id}`));
    expect(row?.token).not.toContain(issued.code);

    const res = await completeJoin({ token, code: issued.code, name: 'דנה', password: PASSWORD });
    expect(res).toEqual({ ok: true, email });
    const u = await userByEmail(email);
    expect(u?.name).toBe('דנה');
    expect(u?.emailVerified).toBeTruthy();
    expect(await authorizeCredentials({ email, password: PASSWORD })).toMatchObject({ email });
    // the code cannot be replayed
    expect(await completeJoin({ token, code: issued.code, name: 'דנה', password: PASSWORD })).toMatchObject({ ok: false });
    // the invite itself stays pending: membership is team.acceptInvite's job after sign-in
    const [inv] = await ownerDb.select().from(invitations).where(eq(invitations.id, id));
    expect(inv?.status).toBe('pending');
  });

  it('a new code replaces the old one', async () => {
    const rid = await makeRestaurant();
    const email = uniqueEmail('replace');
    const { token } = await makeInvite({ restaurantId: rid, email });
    const first = await issueJoinCode(token);
    let second = await issueJoinCode(token);
    while (second.ok && first.ok && second.code === first.code) second = await issueJoinCode(token);
    if (!first.ok || !second.ok) throw new Error('issue failed');
    expect(await completeJoin({ token, code: first.code, name: 'דנה', password: PASSWORD })).toMatchObject({
      ok: false,
      reason: 'wrongCode',
    });
    expect(await completeJoin({ token, code: second.code, name: 'דנה', password: PASSWORD })).toMatchObject({ ok: true });
  });

  it('an expired code is refused', async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('late') });
    const issued = await issueJoinCode(token);
    if (!issued.ok) throw new Error('issue failed');
    const later = Date.now() + JOIN_CODE_TTL_MS + 1000;
    expect(await completeJoin({ token, code: issued.code, name: 'דנה', password: PASSWORD }, later)).toMatchObject({
      ok: false,
      reason: 'noCode',
    });
  });

  it(`locks after ${JOIN_CODE_MAX_ATTEMPTS} wrong codes — durable, no rate-limit store involved`, async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('brute') });
    const issued = await issueJoinCode(token);
    if (!issued.ok) throw new Error('issue failed');
    const wrong = issued.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < JOIN_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await completeJoin({ token, code: wrong, name: 'דנה', password: PASSWORD })).toMatchObject({
        reason: 'wrongCode',
      });
    }
    // the 6th try is locked even with the RIGHT code, and that code is now dead
    expect(await completeJoin({ token, code: issued.code, name: 'דנה', password: PASSWORD })).toMatchObject({
      reason: 'locked',
    });
  });

  it('validates name and password before spending an attempt', async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('policy') });
    const issued = await issueJoinCode(token);
    if (!issued.ok) throw new Error('issue failed');
    expect(await completeJoin({ token, code: issued.code, name: 'x', password: PASSWORD })).toMatchObject({ reason: 'name' });
    expect(await completeJoin({ token, code: issued.code, name: 'דנה', password: 'short' })).toMatchObject({
      reason: 'policy',
    });
    expect(await completeJoin({ token, code: issued.code, name: 'דנה', password: PASSWORD })).toMatchObject({ ok: true });
  });
});
