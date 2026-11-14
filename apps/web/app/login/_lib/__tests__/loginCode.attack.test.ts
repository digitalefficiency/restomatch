import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql, users, verificationTokens } from '@restomatch/db';
import { cleanup, makeUser, ownerDb, uniqueEmail } from '../../../join/__tests__/helpers';
import { loginCodeEmail } from '../codeEmail';
import {
  LOGIN_CODE_DAILY_MAX,
  LOGIN_CODE_LIFT_BUDGET,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  LOGIN_CODE_WEEKLY_MAX,
  issueLoginCode,
  liftLoginCodeLock,
  loginCodeKey,
  loginCodeLocked,
  verifyLoginCode,
} from '../loginCode';

/** W3-07b slice b: the 6-digit sign-in code. Add-only attack suite (warden + conductor review rounds 2–3). */
const like = (col: typeof verificationTokens.identifier, pattern: string) => sql`${col} like ${pattern}`;
const touched: string[] = [];
afterAll(async () => {
  for (const email of touched) {
    await ownerDb.delete(verificationTokens).where(like(verificationTokens.identifier, `lc-%:${loginCodeKey(email)}`));
  }
  await cleanup();
});

function track(email: string): string {
  touched.push(email);
  return email;
}

async function codeFor(email: string, now?: number): Promise<string> {
  const r = await issueLoginCode(email, now);
  if (!r) throw new Error('no code issued');
  return r.code;
}

const wrongFor = (code: string) => (code === '000000' ? '111111' : '000000');
const HOUR = 60 * 60 * 1000;

/** Burn `n` 10-minute windows of wrong codes; returns the clock after them. */
async function burnWindows(email: string, n: number, start: number): Promise<number> {
  let now = start;
  for (let w = 0; w < n; w += 1) {
    const code = await codeFor(email, now);
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyLoginCode(email, wrongFor(code), now)).toMatchObject({ ok: false, reason: 'wrongCode' });
    }
    now += LOGIN_CODE_TTL_MS + 1000;
  }
  return now;
}

describe('login code — basics', () => {
  it('happy path: issue → verify once → the code is spent, the address verified', async () => {
    const email = track(uniqueEmail('login'));
    const uid = await makeUser(email);
    await ownerDb.update(users).set({ emailVerified: null }).where(eq(users.id, uid));
    const code = await codeFor(email.toUpperCase()); // case-insensitive address
    const [row] = await ownerDb.select().from(verificationTokens).where(eq(verificationTokens.identifier, `login:${uid}`));
    expect(row?.token).not.toContain(code);
    expect(await verifyLoginCode(email, code)).toEqual({ ok: true, userId: uid });
    expect(await verifyLoginCode(email, code)).toMatchObject({ ok: false, reason: 'wrongCode' });
    const [u] = await ownerDb.select().from(users).where(eq(users.id, uid));
    expect(u?.emailVerified).toBeTruthy();
  });

  it("A's code never signs in B", async () => {
    const a = track(uniqueEmail('a'));
    const b = track(uniqueEmail('b'));
    await makeUser(a);
    await makeUser(b);
    const codeA = await codeFor(a);
    let codeB = await codeFor(b);
    while (codeB === codeA) codeB = await codeFor(b);
    expect(await verifyLoginCode(b, codeA)).toMatchObject({ ok: false, reason: 'wrongCode' });
  });

  it('a new code replaces the old one; an expired code is refused', async () => {
    const email = track(uniqueEmail('replace'));
    await makeUser(email);
    const first = await codeFor(email);
    let second = await codeFor(email);
    while (second === first) second = await codeFor(email);
    expect(await verifyLoginCode(email, first)).toMatchObject({ reason: 'wrongCode' });
    expect(await verifyLoginCode(email, second, Date.now() + LOGIN_CODE_TTL_MS + 1000)).toMatchObject({ reason: 'wrongCode' });
  });

  it('atomic use: concurrent verifies of the right code sign in exactly once', async () => {
    const email = track(uniqueEmail('race'));
    await makeUser(email);
    const code = await codeFor(email);
    const res = await Promise.all([verifyLoginCode(email, code), verifyLoginCode(email, code), verifyLoginCode(email, code)]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
  });

  it('concurrent wrong guesses cannot overshoot the window ceiling', async () => {
    const email = track(uniqueEmail('burst'));
    await makeUser(email);
    const code = await codeFor(email);
    const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, '0'));
    const res = await Promise.all(guesses.map((g) => verifyLoginCode(email, g)));
    expect(res.filter((r) => !r.ok && r.reason === 'wrongCode').length).toBeLessThanOrEqual(LOGIN_CODE_MAX_ATTEMPTS);
    expect((await verifyLoginCode(email, code)).ok).toBe(false);
  });
});

describe('N1: no account / lock-state oracle', () => {
  it('a real account and an unknown address answer identically, step by step, and lock at the same attempt', async () => {
    const real = track(uniqueEmail('real'));
    const ghost = track(uniqueEmail('ghost')); // never created
    await makeUser(real);
    const code = await codeFor(real);
    expect(await issueLoginCode(ghost)).toBeNull();
    const wrong = wrongFor(code);
    for (let i = 1; i <= LOGIN_CODE_MAX_ATTEMPTS + 2; i += 1) {
      const r = await verifyLoginCode(real, wrong);
      const g = await verifyLoginCode(ghost, wrong);
      expect(g).toEqual(r);
      expect(r).toMatchObject({ ok: false, reason: i <= LOGIN_CODE_MAX_ATTEMPTS ? 'wrongCode' : 'locked' });
    }
    expect(await loginCodeLocked(real)).toBe(await loginCodeLocked(ghost));
  });

  it('counters are keyed on the address, not the user id (no user-id rows)', async () => {
    const email = track(uniqueEmail('keyed'));
    const uid = await makeUser(email);
    const code = await codeFor(email);
    await verifyLoginCode(email, wrongFor(code));
    const byUser = await ownerDb.select().from(verificationTokens).where(like(verificationTokens.identifier, `%${uid}%`));
    expect(byUser.map((r) => r.identifier)).toEqual([`login:${uid}`]); // only the code itself
  });
});

describe('M1 / N2: day and week ceilings', () => {
  it(`the ${LOGIN_CODE_DAILY_MAX}/24 h cap holds across fresh codes and windows, then code sign-in is OFF`, async () => {
    const email = track(uniqueEmail('day'));
    await makeUser(email);
    const now = await burnWindows(email, LOGIN_CODE_DAILY_MAX / LOGIN_CODE_MAX_ATTEMPTS, Date.now());
    expect(await loginCodeLocked(email, now)).toBe(true);
    expect(await issueLoginCode(email, now)).toBeNull();
    expect(await verifyLoginCode(email, '123456', now)).toMatchObject({ ok: false, reason: 'locked' });
    expect(await loginCodeLocked(email, now + 25 * HOUR)).toBe(false); // the day expires on its own
  });

  it("N2: the owner's password / magic-link sign-in lifts by a small budget only — it never refills the day", async () => {
    const email = track(uniqueEmail('lift'));
    const uid = await makeUser(email);
    let now = await burnWindows(email, LOGIN_CODE_DAILY_MAX / LOGIN_CODE_MAX_ATTEMPTS, Date.now());
    expect(await loginCodeLocked(email, now)).toBe(true);
    await liftLoginCodeLock(email, now); // the victim signs in with a password
    expect(await loginCodeLocked(email, now)).toBe(false);
    // the attacker gets exactly LIFT_BUDGET more wrong codes, then it is locked again
    const code = await codeFor(email, now);
    for (let i = 0; i < LOGIN_CODE_LIFT_BUDGET; i += 1) {
      expect(await verifyLoginCode(email, wrongFor(code), now)).toMatchObject({ reason: 'wrongCode' });
      if ((i + 1) % LOGIN_CODE_MAX_ATTEMPTS === 0) now += LOGIN_CODE_TTL_MS + 1000;
    }
    expect(await loginCodeLocked(email, now)).toBe(true);
    // lifting when NOT locked adds nothing
    await liftLoginCodeLock(track(uniqueEmail('not-locked')), now);
    // the owner's correct code still works after another lift
    await liftLoginCodeLock(email, now);
    const good = await codeFor(email, now);
    expect(await verifyLoginCode(email, good, now)).toEqual({ ok: true, userId: uid });
  });

  /** Fill the 7-day cap: WEEKLY_MAX / DAILY_MAX days of DAILY_MAX wrong codes; returns the next day's clock. */
  async function burnWeek(email: string, start: number): Promise<number> {
    let now = start;
    const perDay = LOGIN_CODE_DAILY_MAX / LOGIN_CODE_MAX_ATTEMPTS;
    for (let day = 0; day < LOGIN_CODE_WEEKLY_MAX / LOGIN_CODE_DAILY_MAX; day += 1) {
      now = await burnWindows(email, perDay, now);
      now += 25 * HOUR; // next day
    }
    return now;
  }

  it(`the ${LOGIN_CODE_WEEKLY_MAX}/7 days cap: a sign-in lifts it by a small budget, at most once a day`, async () => {
    const email = track(uniqueEmail('week'));
    const uid = await makeUser(email);
    let now = await burnWeek(email, Date.now());
    expect(await loginCodeLocked(email, now)).toBe(true); // the week, not the day
    expect(await issueLoginCode(email, now)).toBeNull();
    // round 4: the owner signs in with a password → code sign-in works again, within the budget
    await liftLoginCodeLock(email, now);
    expect(await loginCodeLocked(email, now)).toBe(false);
    const code = await codeFor(email, now);
    for (let i = 0; i < LOGIN_CODE_LIFT_BUDGET; i += 1) {
      expect(await verifyLoginCode(email, wrongFor(code), now)).toMatchObject({ reason: 'wrongCode' });
      if ((i + 1) % LOGIN_CODE_MAX_ATTEMPTS === 0) now += LOGIN_CODE_TTL_MS + 1000;
    }
    expect(await loginCodeLocked(email, now)).toBe(true);
    // a second sign-in the same day grants nothing more
    await liftLoginCodeLock(email, now);
    expect(await loginCodeLocked(email, now)).toBe(true);
    // the next day it lifts again, and the owner's correct code signs in and clears everything
    now += 25 * HOUR;
    await liftLoginCodeLock(email, now);
    expect(await loginCodeLocked(email, now)).toBe(false);
    const good = await codeFor(email, now);
    expect(await verifyLoginCode(email, good, now)).toEqual({ ok: true, userId: uid });
    expect(await loginCodeLocked(email, now)).toBe(false);
  });

  it('round 4: refused verifies at a locked address insert nothing — 61+ POSTs over days never extend the lock', async () => {
    for (const kind of ['real', 'ghost'] as const) {
      const email = track(uniqueEmail(`renew-${kind}`));
      if (kind === 'real') await makeUser(email);
      const start = Date.now();
      // fill the week (a ghost has no code, so it guesses blind — the counters are the same)
      let now = start;
      for (let i = 0; i < LOGIN_CODE_WEEKLY_MAX; i += 1) {
        expect(await verifyLoginCode(email, '000000', now)).toMatchObject({ ok: false });
        if ((i + 1) % LOGIN_CODE_MAX_ATTEMPTS === 0) now += LOGIN_CODE_TTL_MS + 1000;
        if ((i + 1) % LOGIN_CODE_DAILY_MAX === 0) now += 25 * HOUR;
      }
      expect(await loginCodeLocked(email, now)).toBe(true);
      const before = await ownerDb
        .select()
        .from(verificationTokens)
        .where(like(verificationTokens.identifier, `lc-%:${loginCodeKey(email)}`));
      // the attacker keeps POSTing ~10 refused verifies a day for the rest of the week
      let refused = 0;
      for (let day = 0; day < 4; day += 1) {
        for (let i = 0; i < 10; i += 1) {
          expect(await verifyLoginCode(email, '123456', now)).toEqual({ ok: false, reason: 'locked' });
          refused += 1;
        }
        now += 24 * HOUR;
      }
      expect(refused).toBeGreaterThan(LOGIN_CODE_WEEKLY_MAX / 2);
      const after = await ownerDb
        .select()
        .from(verificationTokens)
        .where(like(verificationTokens.identifier, `lc-%:${loginCodeKey(email)}`));
      expect(after.length).toBe(before.length); // not one row added
      // the lock ends on its own once the first day's markers age out — not extended
      expect(await loginCodeLocked(email, start + 7 * 24 * HOUR + HOUR)).toBe(false);
    }
  });
});

describe('login code e-mail (M7/N4, M1/N2 copy)', () => {
  it('goes out in the page language, keeps the code out of the subject, and does not promise "safe" or push a sign-in', () => {
    for (const locale of ['he', 'en', 'ar', 'ru', 'th', 'ti']) {
      const m = loginCodeEmail({ code: '482913', locale });
      expect(m.subject).not.toContain('482913');
      expect(m.text).toContain('482913');
      expect(m.text.toLowerCase()).not.toMatch(/safe|sign in with your password/);
      expect(m.text).not.toContain('מוגן');
      expect(m.text).not.toContain('היכנסו עם הסיסמה');
    }
    expect(loginCodeEmail({ code: '1', locale: 'ar' }).html).toContain('dir="rtl"');
    expect(loginCodeEmail({ code: '1', locale: 'ru' }).subject).toMatch(/[А-я]/);
    expect(loginCodeEmail({ code: '1', locale: 'th' }).subject).toMatch(/[฀-๿]/);
    expect(loginCodeEmail({ code: '1', locale: 'ti' }).subject).toMatch(/[ሀ-፿]/);
    expect(loginCodeEmail({ code: '1', locale: 'xx' }).subject).toBe(loginCodeEmail({ code: '1', locale: 'he' }).subject);
  });
});
