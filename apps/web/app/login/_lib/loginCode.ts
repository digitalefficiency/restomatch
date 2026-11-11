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
 * Guessing ceilings, all durable rows reserved BEFORE the check (they hold when
 * the rate-limit store fails open, and under concurrent guesses):
 *  - ≤ 5 wrong codes per rolling 10 minutes (`login-fail:<id>`);
 *  - ≤ 20 wrong codes per rolling 24 h (`login-fail24:<id>`). At the daily cap
 *    code sign-in is OFF for the account — no new code is issued and none is
 *    accepted — until a password or magic-link sign-in succeeds
 *    (`clearLoginCodeLock`, called from auth.ts), or the 24 h pass.
 *    Security review M1: with 5/10 min alone, a code every 10 minutes gave 720
 *    guesses a day.
 *
 * Only an EXISTING account gets a code, but the page answers the same either
 * way, and the verify path runs the same queries for an unknown address (no
 * account oracle by timing). The verify runs inside the `email-code`
 * Credentials authorize() in auth.ts, which also applies the login limiter.
 */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_DAILY_MAX = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A stand-in id so an unknown address runs the same queries (never a real user). */
const NOBODY = '00000000-0000-4000-8000-000000000000';

const codeId = (userId: string) => `login:${userId}`;
const failId = (userId: string) => `login-fail:${userId}`;
const fail24Id = (userId: string) => `login-fail24:${userId}`;

function hmacKey(): string {
  const key = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('AUTH_SECRET is required for login codes');
  return key;
}

export function loginCodeDigest(userId: string, code: string): string {
  return createHmac('sha256', hmacKey()).update(`login:${userId}:${code}`).digest('hex');
}

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

/** Has this account hit the daily cap (code sign-in off)? */
export async function loginCodeLocked(userId: string, now = Date.now()): Promise<boolean> {
  return (await liveCount(fail24Id(userId), now)) >= LOGIN_CODE_DAILY_MAX;
}

/**
 * A fresh code for an existing account whose code sign-in is not locked, or
 * null. The caller shows the same "check your e-mail" screen either way.
 */
export async function issueLoginCode(rawEmail: string, now = Date.now()): Promise<{ code: string; email: string } | null> {
  const u = await userIdFor(rawEmail);
  if (!u) return null;
  if (await loginCodeLocked(u.id, now)) return null;
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

export type VerifyLoginCode =
  | { ok: true; userId: string }
  | { ok: false; reason: 'noCode' | 'wrongCode' | 'locked' };

/** Check a code for an address. Spends the code atomically on success. */
export async function verifyLoginCode(rawEmail: string, rawCode: string, now = Date.now()): Promise<VerifyLoginCode> {
  const u = await userIdFor(rawEmail);
  const id = u?.id ?? NOBODY;

  // Same queries whether or not the account exists (timing).
  const [daily, [stored]] = await Promise.all([
    liveCount(fail24Id(id), now),
    authDb
      .select({ token: verificationTokens.token })
      .from(verificationTokens)
      .where(and(eq(verificationTokens.identifier, codeId(id)), gt(verificationTokens.expires, new Date(now))))
      .limit(1),
  ]);
  if (!u) return { ok: false, reason: 'noCode' };
  if (daily >= LOGIN_CODE_DAILY_MAX) return { ok: false, reason: 'locked' };
  if (!stored) return { ok: false, reason: 'noCode' };

  // Reserve the attempt in both windows, then count.
  await authDb.insert(verificationTokens).values([
    { identifier: failId(u.id), token: randomUUID(), expires: new Date(now + LOGIN_CODE_TTL_MS) },
    { identifier: fail24Id(u.id), token: randomUUID(), expires: new Date(now + DAY_MS) },
  ]);
  const [inWindow, inDay] = await Promise.all([liveCount(failId(u.id), now), liveCount(fail24Id(u.id), now)]);
  if (inWindow > LOGIN_CODE_MAX_ATTEMPTS || inDay > LOGIN_CODE_DAILY_MAX) {
    await authDb.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(u.id)));
    return { ok: false, reason: 'locked' };
  }

  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, reason: 'wrongCode' };
  // Atomic use: the row is deleted only if the HMAC matches, in one statement.
  const used = await authDb
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, codeId(u.id)),
        eq(verificationTokens.token, loginCodeDigest(u.id, code)),
        gt(verificationTokens.expires, new Date(now)),
      ),
    )
    .returning({ identifier: verificationTokens.identifier });
  if (used.length === 0) return { ok: false, reason: 'wrongCode' };

  // Success: this attempt was not a failure — clear the window and the day.
  await authDb.delete(verificationTokens).where(inArray(verificationTokens.identifier, [failId(u.id), fail24Id(u.id)]));
  // A code proves the mailbox, like a magic link: mark the address verified.
  await authDb.update(users).set({ emailVerified: new Date(now) }).where(eq(users.id, u.id));
  return { ok: true, userId: u.id };
}

/** A password or magic-link sign-in re-opens code sign-in (clears both failure windows). */
export async function clearLoginCodeLock(userId: string): Promise<void> {
  await authDb.delete(verificationTokens).where(inArray(verificationTokens.identifier, [failId(userId), fail24Id(userId)]));
}
