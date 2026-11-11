import 'server-only';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, users, verificationTokens } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { normalizeLoginEmail } from '@/lib/passwords';

/**
 * W3-07b slice b — sign in with a 6-digit e-mail code (auth-07 phase 2), the
 * code twin of the magic link.
 *
 * Store: `verification_tokens` holds `login:<userId>` → HMAC(code), valid 10
 * min; a new code replaces the old one. Using a code is ONE statement
 * (`DELETE … WHERE token = HMAC RETURNING`), so two concurrent verifies can
 * never both sign in.
 *
 * Guessing ceilings. All are durable rows, keyed on HMAC(normalized e-mail) —
 * NOT the user id — and one attempt is reserved on EVERY verify before any
 * early return. So a real account and an unknown address lock at the same
 * attempt with the same answer (security review N1: no account / lock-state
 * oracle), and the ceilings hold when the rate-limit store fails open:
 *  - ≤ 5 wrong codes per rolling 10 minutes;
 *  - ≤ 20 per rolling 24 h, plus LIFT_BUDGET more for each time the owner
 *    lifted the lock by signing in with a password or magic link
 *    (`liftLoginCodeLock`). A lift adds a small budget; it never erases the
 *    history (review N2: the victim's own sign-ins must not refill an
 *    attacker's budget);
 *  - ≤ 60 per rolling 7 days, cleared ONLY by a correct code.
 * At a ceiling no code is issued and none is accepted.
 *
 * Only an existing account gets a code; the page answers the same either way.
 * The verify runs inside the `email-code` Credentials authorize() in auth.ts,
 * which also applies the login limiter and maps "locked" to the limiter's code.
 */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_DAILY_MAX = 20;
export const LOGIN_CODE_LIFT_BUDGET = 5;
export const LOGIN_CODE_WEEKLY_MAX = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function hmacKey(): string {
  const key = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('AUTH_SECRET is required for login codes');
  return key;
}

/** The counter key for an address: never the user id, never the raw address. */
export function loginCodeKey(rawEmail: string): string {
  const email = normalizeLoginEmail(rawEmail) || String(rawEmail ?? '').trim().toLowerCase();
  return createHmac('sha256', hmacKey()).update(`login-key:${email}`).digest('hex').slice(0, 40);
}

export function loginCodeDigest(userId: string, code: string): string {
  return createHmac('sha256', hmacKey()).update(`login:${userId}:${code}`).digest('hex');
}

const codeId = (userId: string) => `login:${userId}`;
const winId = (k: string) => `lc-w:${k}`;
const dayId = (k: string) => `lc-d:${k}`;
const weekId = (k: string) => `lc-7:${k}`;
const liftId = (k: string) => `lc-lift:${k}`;

async function userIdFor(rawEmail: string): Promise<{ id: string; email: string } | null> {
  const email = normalizeLoginEmail(rawEmail);
  if (!email) return null;
  const [u] = await authDb.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  return u ?? null;
}

async function liveCount(identifier: string, now: number): Promise<number> {
  const [r] = await authDb
    .select({ c: count() })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), gt(verificationTokens.expires, new Date(now))));
  return Number(r?.c ?? 0);
}

interface Counts {
  win: number;
  day: number;
  week: number;
  lifts: number;
}

async function countsFor(k: string, now: number): Promise<Counts> {
  const [win, day, week, lifts] = await Promise.all([
    liveCount(winId(k), now),
    liveCount(dayId(k), now),
    liveCount(weekId(k), now),
    liveCount(liftId(k), now),
  ]);
  return { win, day, week, lifts };
}

/** At or over a ceiling (`inclusive` = the count already includes this attempt). */
function overCap(c: Counts, inclusive: boolean): boolean {
  const dayCap = LOGIN_CODE_DAILY_MAX + LOGIN_CODE_LIFT_BUDGET * c.lifts;
  if (inclusive) return c.win > LOGIN_CODE_MAX_ATTEMPTS || c.day > dayCap || c.week > LOGIN_CODE_WEEKLY_MAX;
  return c.win >= LOGIN_CODE_MAX_ATTEMPTS || c.day >= dayCap || c.week >= LOGIN_CODE_WEEKLY_MAX;
}

/** Is code sign-in locked for this address (any ceiling reached)? */
export async function loginCodeLocked(rawEmail: string, now = Date.now()): Promise<boolean> {
  return overCap(await countsFor(loginCodeKey(rawEmail), now), false);
}

/**
 * A fresh code for an existing account whose code sign-in is not locked, or
 * null. The caller shows the same "check your e-mail" screen either way.
 */
export async function issueLoginCode(rawEmail: string, now = Date.now()): Promise<{ code: string; email: string } | null> {
  const [u, locked] = await Promise.all([userIdFor(rawEmail), loginCodeLocked(rawEmail, now)]);
  if (!u || locked) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await authDb.transaction(async (tx) => {
    await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(u.id)));
    await tx.insert(verificationTokens).values({
      identifier: codeId(u.id),
      token: loginCodeDigest(u.id, code),
      expires: new Date(now + LOGIN_CODE_TTL_MS),
    });
  });
  return { code, email: u.email };
}

export type VerifyLoginCode = { ok: true; userId: string } | { ok: false; reason: 'wrongCode' | 'locked' };

/**
 * Check a code for an address. Every call reserves one attempt FIRST — for a
 * real account, an unknown address, or no live code alike — then answers.
 * "No such account" and "no live code" are both a plain `wrongCode`.
 */
export async function verifyLoginCode(rawEmail: string, rawCode: string, now = Date.now()): Promise<VerifyLoginCode> {
  const k = loginCodeKey(rawEmail);
  await authDb.insert(verificationTokens).values([
    { identifier: winId(k), token: randomUUID(), expires: new Date(now + LOGIN_CODE_TTL_MS) },
    { identifier: dayId(k), token: randomUUID(), expires: new Date(now + DAY_MS) },
    { identifier: weekId(k), token: randomUUID(), expires: new Date(now + WEEK_MS) },
  ]);
  const [c, u] = await Promise.all([countsFor(k, now), userIdFor(rawEmail)]);
  if (overCap(c, true)) {
    if (u) await authDb.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(u.id)));
    return { ok: false, reason: 'locked' };
  }

  const code = String(rawCode ?? '').replace(/\D/g, '');
  // Same statement shape for an unknown address (it just matches nothing).
  const uid = u?.id ?? '00000000-0000-4000-8000-000000000000';
  const used = await authDb
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, codeId(uid)),
        eq(verificationTokens.token, loginCodeDigest(uid, code.length === 6 ? code : 'x')),
        gt(verificationTokens.expires, new Date(now)),
      ),
    )
    .returning({ identifier: verificationTokens.identifier });
  if (!u || used.length === 0) return { ok: false, reason: 'wrongCode' };

  // A correct code — the only thing that clears every ceiling (incl. 7 days).
  await authDb
    .delete(verificationTokens)
    .where(inArray(verificationTokens.identifier, [winId(k), dayId(k), weekId(k), liftId(k)]));
  // A code proves the mailbox, like a magic link: mark the address verified.
  await authDb.update(users).set({ emailVerified: new Date(now) }).where(eq(users.id, u.id));
  return { ok: true, userId: u.id };
}

/**
 * A password or magic-link sign-in LIFTS an active 24 h lock by adding a small
 * budget (one marker = LIFT_BUDGET more tries today). It keeps the history, and
 * it never lifts the 7-day ceiling — only a correct code does (review N2).
 */
export async function liftLoginCodeLock(rawEmail: string, now = Date.now()): Promise<void> {
  const k = loginCodeKey(rawEmail);
  const c = await countsFor(k, now);
  const dayCap = LOGIN_CODE_DAILY_MAX + LOGIN_CODE_LIFT_BUDGET * c.lifts;
  if (c.day < dayCap) return; // not locked by the day cap: nothing to lift
  await authDb.insert(verificationTokens).values({ identifier: liftId(k), token: randomUUID(), expires: new Date(now + DAY_MS) });
}
