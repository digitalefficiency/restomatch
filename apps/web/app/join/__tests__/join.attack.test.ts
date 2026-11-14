import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, invitations, memberships, userCredentials } from '@restomatch/db';
import { authorizeCredentials, setUserPassword } from '@/lib/passwords';
import {
  JOIN_CODE_MAX_ATTEMPTS,
  JOIN_CODE_MAX_TOTAL_ATTEMPTS,
  JOIN_CODE_SENDS_PER_15_MIN,
  JOIN_CODE_TTL_MS,
  completeJoin,
  invitedAccountExists,
  issueJoinCode,
  publicCompleteReason,
  loadInvite,
} from '../_lib/joinFlow';
import { joinSignInEmail } from '../_lib/codeEmail';
import { cleanup, makeInvite, makeRestaurant, makeUser, membershipsOf, ownerDb, uniqueEmail, userByEmail } from './helpers';

/**
 * W3-07b attack suite for the public `/join/<token>` write path (programme risk
 * 14; tenant-security-warden reviews). Add-only.
 */
const PASSWORD = 'correct horse battery 42';

afterAll(cleanup);

async function issued(token: string, now?: number): Promise<string> {
  const r = await issueJoinCode(token, now);
  if (!r.ok) throw new Error(`issue failed: ${r.reason}`);
  return r.code;
}

describe('join attack: dead tokens', () => {
  for (const status of ['accepted', 'revoked', 'expired'] as const) {
    it(`a ${status} invite cannot mint a code, complete, or reveal the restaurant`, async () => {
      const rid = await makeRestaurant('סוד');
      const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail(status), status });
      const view = await loadInvite(token);
      expect(view.state).not.toBe('valid');
      expect(view.restaurantName).toBeNull();
      expect(view.role).toBeNull();
      expect(await issueJoinCode(token)).toMatchObject({ ok: false });
      expect(await completeJoin({ token, code: '123456', name: 'דנה', password: PASSWORD })).toMatchObject({ ok: false });
    });
  }

  it('a past-expiry pending invite is dead too', async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('past'), expiresInMs: -1000 });
    expect((await loadInvite(token)).state).toBe('expired');
    expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('garbage and unknown tokens read as not-found without touching anything', async () => {
    for (const t of ['', 'x', "'; drop table users;--", 'a'.repeat(500), randomBytes(32).toString('base64url')]) {
      expect((await loadInvite(t)).state).toBe('notFound');
      expect(await issueJoinCode(t)).toMatchObject({ ok: false, reason: 'notFound' });
    }
  });

  it('a resend (token rotation) kills the old link and its code', async () => {
    const rid = await makeRestaurant();
    const { token, id } = await makeInvite({ restaurantId: rid, email: uniqueEmail('rotate') });
    const code = await issued(token);
    const fresh = randomBytes(32).toString('base64url');
    await ownerDb
      .update(invitations)
      .set({ tokenHash: createHash('sha256').update(fresh).digest('hex') })
      .where(eq(invitations.id, id));
    expect(await completeJoin({ token, code, name: 'דנה', password: PASSWORD })).toMatchObject({ reason: 'notFound' });
    // the old code is bound to the old hash, so it does not carry over to the new link either
    expect(await completeJoin({ token: fresh, code, name: 'דנה', password: PASSWORD })).toMatchObject({ ok: false });
  });
});

describe('join attack: binding', () => {
  it('a code for invite X never completes invite Y', async () => {
    const rid = await makeRestaurant();
    const x = await makeInvite({ restaurantId: rid, email: uniqueEmail('x') });
    const y = await makeInvite({ restaurantId: rid, email: uniqueEmail('y') });
    const codeX = await issued(x.token);
    let codeY = await issued(y.token);
    while (codeY === codeX) codeY = await issued(y.token);
    expect(await completeJoin({ token: y.token, code: codeX, name: 'דנה', password: PASSWORD })).toMatchObject({
      reason: 'wrongCode',
    });
  });

  it('the account is always the INVITED address and no membership is written by the code step', async () => {
    const ridA = await makeRestaurant('A');
    const email = uniqueEmail('bound');
    const { token } = await makeInvite({ restaurantId: ridA, email, role: 'receiver' });
    const code = await issued(token);
    // extra form fields an attacker might add are not part of the contract
    const res = await completeJoin({ token, code, name: 'דנה', password: PASSWORD, ...({ email: 'evil@x.example', role: 'owner' } as object) });
    expect(res).toEqual({ ok: true, email });
    const u = await userByEmail(email);
    expect(u).not.toBeNull();
    expect(await membershipsOf(u!.id)).toHaveLength(0);
    expect(await userByEmail('evil@x.example')).toBeNull();
    const all = await ownerDb.select().from(memberships).where(eq(memberships.restaurantId, ridA));
    expect(all).toHaveLength(0);
  });

  it('an address that already has a password is never taken over by a code', async () => {
    const rid = await makeRestaurant();
    const email = uniqueEmail('owned');
    const { token } = await makeInvite({ restaurantId: rid, email });
    // a code issued BEFORE the victim set a password must not overwrite it later
    const code = await issued(token);
    const uid = await makeUser(email, 'Victim');
    await setUserPassword(uid, 'victim original password');
    expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'hasPassword' });
    expect(await completeJoin({ token, code, name: 'Evil', password: PASSWORD })).toMatchObject({ reason: 'hasPassword' });
    expect(await authorizeCredentials({ email, password: 'victim original password' })).toMatchObject({ email });
    expect(await authorizeCredentials({ email, password: PASSWORD })).toBeNull();
    expect((await userByEmail(email))?.name).toBe('Victim');
  });
});

describe('join attack: aliases', () => {
  it('a canonical alias of a password account is sent to sign in, not given a second account', async () => {
    const rid = await makeRestaurant();
    const n = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const uid = await makeUser(`w307b${n}@gmail.com`, 'Owner of mailbox');
    await setUserPassword(uid, 'victim original password');
    const { token } = await makeInvite({ restaurantId: rid, email: `w307b.${n}+kitchen@gmail.com` });
    expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'hasPassword' });
    expect(await userByEmail(`w307b.${n}+kitchen@gmail.com`)).toBeNull();
  });
});

describe('join attack: guessing', () => {
  it(`the lifetime ceiling (${JOIN_CODE_MAX_TOTAL_ATTEMPTS}) holds across fresh codes and windows`, async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('slow') });
    let now = Date.now();
    const windows = JOIN_CODE_MAX_TOTAL_ATTEMPTS / JOIN_CODE_MAX_ATTEMPTS;
    for (let w = 0; w < windows; w += 1) {
      const code = await issued(token, now);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < JOIN_CODE_MAX_ATTEMPTS; i += 1) {
        expect(await completeJoin({ token, code: wrong, name: 'דנה', password: PASSWORD }, now)).toMatchObject({
          reason: 'wrongCode',
        });
      }
      now += JOIN_CODE_TTL_MS + 1000; // a new window
    }
    const code = await issued(token, now);
    expect(await completeJoin({ token, code, name: 'דנה', password: PASSWORD }, now)).toMatchObject({ reason: 'locked' });
  });

  it('concurrent guesses cannot overshoot the window ceiling', async () => {
    const rid = await makeRestaurant();
    const { token } = await makeInvite({ restaurantId: rid, email: uniqueEmail('burst') });
    const code = await issued(token);
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const results = await Promise.all(guesses.map((g) => completeJoin({ token, code: g, name: 'דנה', password: PASSWORD })));
    const wrongs = results.filter((r) => !r.ok && r.reason === 'wrongCode').length;
    expect(wrongs).toBeLessThanOrEqual(JOIN_CODE_MAX_ATTEMPTS);
    // the lock also killed the code: even the right one is refused now
    const after = await completeJoin({ token, code, name: 'דנה', password: PASSWORD });
    expect(after.ok).toBe(false);
    expect(['locked', 'noCode']).toContain(after.ok ? 'ok' : after.reason);
  });
});

describe('join attack: B5 — a tenant owner brute-forcing the join code', () => {
  const credentialsOf = (uid: string) => ownerDb.select().from(userCredentials).where(eq(userCredentials.userId, uid));
  const revoke = (id: string) => ownerDb.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, id));

  it('revoke → re-invite against an EXISTING passwordless user never mints a code and never sets a password', async () => {
    const rid = await makeRestaurant('מסעדה זדונית');
    const email = uniqueEmail('passwordless');
    const uid = await makeUser(email, 'Victim'); // e.g. a magic-link-only account in another tenant
    const before = await userByEmail(email);
    for (let round = 0; round < 6; round += 1) {
      const { token, id } = await makeInvite({ restaurantId: rid, email });
      expect(await invitedAccountExists(token)).toBe(true);
      expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'hasPassword' });
      for (const guess of ['000000', '123456', '999999']) {
        const r = await completeJoin({ token, code: guess, name: 'Evil', password: PASSWORD });
        expect(r.ok).toBe(false);
      }
      await revoke(id);
    }
    expect(await credentialsOf(uid)).toEqual([]);
    expect(await authorizeCredentials({ email, password: PASSWORD })).toBeNull();
    const after = await userByEmail(email);
    expect(after?.name).toBe('Victim');
    expect(after?.emailVerified?.getTime()).toBe(before?.emailVerified?.getTime());
  });

  it('even a CORRECT code minted before the account existed never sets a password on the existing row', async () => {
    const rid = await makeRestaurant();
    const email = uniqueEmail('late-account');
    const { token } = await makeInvite({ restaurantId: rid, email });
    const code = await issued(token);
    const uid = await makeUser(email, 'Victim'); // passwordless row appears after the code
    expect(await completeJoin({ token, code, name: 'Evil', password: PASSWORD })).toMatchObject({ ok: false, reason: 'hasPassword' });
    expect(await credentialsOf(uid)).toEqual([]);
    expect((await userByEmail(email))?.name).toBe('Victim');
  });

  it('a canonical alias of a passwordless account is sent to sign in too', async () => {
    const rid = await makeRestaurant();
    const n = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const uid = await makeUser(`w307bpl${n}@gmail.com`, 'Owner of mailbox');
    const { token } = await makeInvite({ restaurantId: rid, email: `w307b.pl${n}+bar@gmail.com` });
    expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'hasPassword' });
    expect(await credentialsOf(uid)).toEqual([]);
  });

  it('the guess ceilings are keyed on the ADDRESS: revoke → re-invite (and resend) keeps the count growing', async () => {
    const rid = await makeRestaurant();
    const email = uniqueEmail('rotating');
    let now = Date.now();
    let wrongs = 0;
    // each round: a fresh invite (new id + token), one code, up to the window cap of wrong guesses, revoke
    while (wrongs < JOIN_CODE_MAX_TOTAL_ATTEMPTS) {
      const { token, id } = await makeInvite({ restaurantId: rid, email });
      const code = await issued(token, now);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < JOIN_CODE_MAX_ATTEMPTS && wrongs < JOIN_CODE_MAX_TOTAL_ATTEMPTS; i += 1) {
        expect(await completeJoin({ token, code: wrong, name: 'דנה', password: PASSWORD }, now)).toMatchObject({ reason: 'wrongCode' });
        wrongs += 1;
      }
      await revoke(id);
      now += JOIN_CODE_TTL_MS + 1000;
    }
    const { token } = await makeInvite({ restaurantId: rid, email });
    const code = await issued(token, now);
    expect(await completeJoin({ token, code, name: 'דנה', password: PASSWORD }, now)).toMatchObject({ reason: 'locked' });
    expect(await userByEmail(email)).toBeNull();
  });

  it('the window cap is shared by every invite to the same address', async () => {
    const rid = await makeRestaurant();
    const rid2 = await makeRestaurant();
    const email = uniqueEmail('two-tenants');
    const a = await makeInvite({ restaurantId: rid, email });
    const codeA = await issued(a.token);
    for (let i = 0; i < JOIN_CODE_MAX_ATTEMPTS; i += 1) {
      await completeJoin({ token: a.token, code: codeA === '000000' ? '111111' : '000000', name: 'דנה', password: PASSWORD });
    }
    const b = await makeInvite({ restaurantId: rid2, email });
    const codeB = await issued(b.token);
    expect(await completeJoin({ token: b.token, code: codeB, name: 'דנה', password: PASSWORD })).toMatchObject({ reason: 'locked' });
  });

  it(`code sends are capped per address (${JOIN_CODE_SENDS_PER_15_MIN} / 15 min), across invites`, async () => {
    const email = uniqueEmail('send-cap');
    for (let i = 0; i < JOIN_CODE_SENDS_PER_15_MIN; i += 1) {
      const { token } = await makeInvite({ restaurantId: await makeRestaurant(), email });
      expect((await issueJoinCode(token)).ok).toBe(true);
    }
    const { token } = await makeInvite({ restaurantId: await makeRestaurant(), email });
    expect(await issueJoinCode(token)).toMatchObject({ ok: false, reason: 'rate' });
    expect((await issueJoinCode(token, Date.now() + 16 * 60 * 1000)).ok).toBe(true);
  });
});

describe('join attack: no account oracle for the inviting owner (security review, /join)', () => {
  /** What the public page shows for each attempt (the action maps reasons through publicCompleteReason). */
  async function publicTrail(token: string, attempts: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < attempts; i += 1) {
      const r = await completeJoin({ token, code: '000000', name: 'דנה', password: PASSWORD });
      out.push(r.ok ? 'ok' : publicCompleteReason(r.reason));
    }
    return out;
  }

  it('after "send", an existing account and a new address answer the same, step by step, and lock at the same attempt', async () => {
    const rid = await makeRestaurant();
    const existing = uniqueEmail('oracle-existing');
    const fresh = uniqueEmail('oracle-fresh');
    await makeUser(existing, 'Has an account');
    const a = await makeInvite({ restaurantId: rid, email: existing });
    const b = await makeInvite({ restaurantId: rid, email: fresh });
    // send: the existing account gets no code (the action e-mails a sign-in link); the new address a code
    expect(await issueJoinCode(a.token)).toMatchObject({ ok: false, reason: 'hasPassword' });
    const sentB = await issueJoinCode(b.token);
    expect(sentB.ok).toBe(true);
    if (sentB.ok && sentB.code === '000000') await issueJoinCode(b.token); // keep '000000' a wrong guess
    const trailA = await publicTrail(a.token, JOIN_CODE_MAX_ATTEMPTS + 2);
    const trailB = await publicTrail(b.token, JOIN_CODE_MAX_ATTEMPTS + 2);
    expect(trailA).toEqual(trailB);
    expect(trailA).toEqual([...Array(JOIN_CODE_MAX_ATTEMPTS).fill('wrongCode'), 'locked', 'locked']);
  });

  it('the per-address send cap applies to an existing account too (no "never throttled" tell)', async () => {
    const email = uniqueEmail('oracle-cap');
    await makeUser(email, 'Has an account');
    const reasons: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { token } = await makeInvite({ restaurantId: await makeRestaurant(), email });
      const r = await issueJoinCode(token);
      reasons.push(r.ok ? 'ok' : r.reason === 'hasPassword' && r.throttled ? 'rate' : r.reason);
    }
    // the action answers "rate" on the 4th send, exactly as for a new address
    expect(reasons).toEqual(['hasPassword', 'hasPassword', 'hasPassword', 'rate']);
  });

  it('publicCompleteReason folds "no code" and "has an account" into a wrong code', () => {
    expect(publicCompleteReason('noCode')).toBe('wrongCode');
    expect(publicCompleteReason('hasPassword')).toBe('wrongCode');
    expect(publicCompleteReason('locked')).toBe('locked');
    expect(publicCompleteReason('expired')).toBe('expired');
  });

  it('the sign-in e-mail for an existing account carries a sign-in link and no code', () => {
    const url = 'https://app.example/login?callbackUrl=%2Finvite%2Faccept%3Ftoken%3Dabc%26then%3Dwelcome';
    for (const locale of ['he', 'en'] as const) {
      const m = joinSignInEmail({ url, restaurantName: 'מסעדת בדיקה', locale });
      expect(m.text).toContain(url);
      expect(m.html).toContain('href="https://app.example/login?callbackUrl=');
      expect(m.text).not.toMatch(/\b\d{6}\b/);
    }
  });
});
