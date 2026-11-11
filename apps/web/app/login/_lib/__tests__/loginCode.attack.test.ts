import { afterAll, describe, expect, it } from 'vitest';
import { eq, users, verificationTokens } from '@restomatch/db';
import { cleanup, makeUser, ownerDb, uniqueEmail } from '../../../join/__tests__/helpers';
import {
  LOGIN_CODE_DAILY_MAX,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  clearLoginCodeLock,
  issueLoginCode,
  loginCodeLocked,
  verifyLoginCode,
} from '../loginCode';
import { loginCodeEmail } from '../codeEmail';

/** W3-07b slice b: the 6-digit sign-in code. Add-only attack suite (warden). */
afterAll(async () => {
  await cleanup();
});

async function codeFor(email: string, now?: number): Promise<string> {
  const r = await issueLoginCode(email, now);
  if (!r) throw new Error('no code issued');
  return r.code;
}

describe('login code', () => {
  it('happy path: issue → verify once → the code is spent, the address verified', async () => {
    const email = uniqueEmail('login');
    const uid = await makeUser(email);
    await ownerDb.update(users).set({ emailVerified: null }).where(eq(users.id, uid));
    const code = await codeFor(email.toUpperCase()); // case-insensitive address
    const [row] = await ownerDb.select().from(verificationTokens).where(eq(verificationTokens.identifier, `login:${uid}`));
    expect(row?.token).not.toContain(code);
    expect(await verifyLoginCode(email, code)).toEqual({ ok: true, userId: uid });
    expect(await verifyLoginCode(email, code)).toMatchObject({ ok: false, reason: 'noCode' });
    const [u] = await ownerDb.select().from(users).where(eq(users.id, uid));
    expect(u?.emailVerified).toBeTruthy();
  });

  it('an unknown address gets no code and cannot sign in', async () => {
    expect(await issueLoginCode(uniqueEmail('ghost'))).toBeNull();
    expect(await verifyLoginCode(uniqueEmail('ghost'), '123456')).toMatchObject({ ok: false });
  });

  it("A's code never signs in B", async () => {
    const a = uniqueEmail('a');
    const b = uniqueEmail('b');
    await makeUser(a);
    await makeUser(b);
    const codeA = await codeFor(a);
    let codeB = await codeFor(b);
    while (codeB === codeA) codeB = await codeFor(b);
    expect(await verifyLoginCode(b, codeA)).toMatchObject({ ok: false, reason: 'wrongCode' });
  });

  it('a new code replaces the old one; an expired code is refused', async () => {
    const email = uniqueEmail('replace');
    await makeUser(email);
    const first = await codeFor(email);
    let second = await codeFor(email);
    while (second === first) second = await codeFor(email);
    expect(await verifyLoginCode(email, first)).toMatchObject({ reason: 'wrongCode' });
    const later = Date.now() + LOGIN_CODE_TTL_MS + 1000;
    expect(await verifyLoginCode(email, second, later)).toMatchObject({ reason: 'noCode' });
  });

  it(`locks after ${LOGIN_CODE_MAX_ATTEMPTS} wrong codes and kills the live code (durable, no limiter)`, async () => {
    const email = uniqueEmail('brute');
    await makeUser(email);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyLoginCode(email, wrong)).toMatchObject({ reason: 'wrongCode' });
    }
    expect(await verifyLoginCode(email, code)).toMatchObject({ reason: 'locked' });
    expect(await verifyLoginCode(email, code)).toMatchObject({ ok: false });
  });

  it('concurrent guesses cannot overshoot the ceiling', async () => {
    const email = uniqueEmail('burst');
    await makeUser(email);
    const code = await codeFor(email);
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const res = await Promise.all(guesses.map((g) => verifyLoginCode(email, g)));
    expect(res.filter((r) => !r.ok && r.reason === 'wrongCode').length).toBeLessThanOrEqual(LOGIN_CODE_MAX_ATTEMPTS);
    expect((await verifyLoginCode(email, code)).ok).toBe(false);
  });

  it(`M1: the ${LOGIN_CODE_DAILY_MAX}/24h cap holds across fresh codes and windows, then code sign-in is OFF`, async () => {
    const email = uniqueEmail('slow-brute');
    const uid = await makeUser(email);
    let now = Date.now();
    const windows = LOGIN_CODE_DAILY_MAX / LOGIN_CODE_MAX_ATTEMPTS;
    for (let w = 0; w < windows; w += 1) {
      const code = await codeFor(email, now);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
        expect(await verifyLoginCode(email, wrong, now)).toMatchObject({ reason: 'wrongCode' });
      }
      now += LOGIN_CODE_TTL_MS + 1000; // the 10-minute window resets, the day does not
    }
    expect(await loginCodeLocked(uid, now)).toBe(true);
    expect(await issueLoginCode(email, now)).toBeNull(); // no new code at the cap
    // a code issued before the cap is refused too
    expect(await verifyLoginCode(email, '123456', now)).toMatchObject({ ok: false, reason: 'locked' });
    // a password / magic-link sign-in re-opens it
    await clearLoginCodeLock(uid);
    const fresh = await codeFor(email, now);
    expect(await verifyLoginCode(email, fresh, now)).toEqual({ ok: true, userId: uid });
  });

  it('M1: the day cap expires after 24 h on its own', async () => {
    const email = uniqueEmail('day-expiry');
    const uid = await makeUser(email);
    let now = Date.now();
    for (let w = 0; w < LOGIN_CODE_DAILY_MAX / LOGIN_CODE_MAX_ATTEMPTS; w += 1) {
      const code = await codeFor(email, now);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i += 1) await verifyLoginCode(email, wrong, now);
      now += LOGIN_CODE_TTL_MS + 1000;
    }
    expect(await loginCodeLocked(uid, now)).toBe(true);
    expect(await loginCodeLocked(uid, now + 25 * 60 * 60 * 1000)).toBe(false);
  });

  it('a success clears the failure windows', async () => {
    const email = uniqueEmail('clear');
    const uid = await makeUser(email);
    const code = await codeFor(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i += 1) await verifyLoginCode(email, wrong);
    expect(await verifyLoginCode(email, code)).toEqual({ ok: true, userId: uid });
    const rows = await ownerDb.select().from(verificationTokens).where(eq(verificationTokens.identifier, `login-fail24:${uid}`));
    expect(rows).toHaveLength(0);
  });

  it('atomic use: two concurrent verifies of the right code sign in exactly once', async () => {
    const email = uniqueEmail('race');
    await makeUser(email);
    const code = await codeFor(email);
    const res = await Promise.all([verifyLoginCode(email, code), verifyLoginCode(email, code), verifyLoginCode(email, code)]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('login code e-mail (M7, M1 copy)', () => {
  it('goes out in the page language, never puts the code in the subject, and does not promise "safe"', () => {
    for (const locale of ['he', 'en', 'ar', 'ru', 'th', 'ti']) {
      const m = loginCodeEmail({ code: '482913', locale });
      expect(m.subject).not.toContain('482913');
      expect(m.text).toContain('482913');
      expect(m.text.toLowerCase()).not.toContain('safe');
      expect(m.text).not.toContain('מוגן');
    }
    expect(loginCodeEmail({ code: '1', locale: 'ar' }).html).toContain('dir="rtl"');
    expect(loginCodeEmail({ code: '1', locale: 'ru' }).subject).toMatch(/[А-я]/);
    expect(loginCodeEmail({ code: '1', locale: 'xx' }).subject).toBe(loginCodeEmail({ code: '1', locale: 'he' }).subject);
  });
});
