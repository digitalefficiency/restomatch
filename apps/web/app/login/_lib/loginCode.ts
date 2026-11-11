import 'server-only';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, eq, gt, inArray, users, verificationTokens } from '@restomatch/db';
import { authDb } from '@/lib/authDb';
import { normalizeLoginEmail } from '@/lib/passwords';

/**
 * W3-07b slice b — sign in with a 6-digit e-mail code (auth-07 phase 2), the
 * code twin of the magic link. Same store and rules as the /join code:
 * `verification_tokens` holds `login:<userId>` → HMAC(code), valid 10 min; a
 * new code replaces the old one; failed tries are durable marker rows reserved
 * BEFORE the compare (≤5 per 10-min window), so the ceiling holds when the
 * rate-limit store fails open. Only an EXISTING account gets a code, but the
 * caller always shows the same "check your e-mail" screen (no enumeration).
 * The verify runs inside the `email-code` Credentials authorize() in auth.ts,
 * which also applies the per-email + per-IP login limiter.
 */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

const codeId = (userId: string) => `login:${userId}`;
const failId = (userId: string) => `login-fail:${userId}`;

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

/** A fresh code for an existing account, or null (the caller still shows "sent"). */
export async function issueLoginCode(rawEmail: string, now = Date.now()): Promise<{ code: string; email: string } | null> {
  const u = await userIdFor(rawEmail);
  if (!u) return null;
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

async function liveCount(identifier: string, now: number): Promise<number> {
  const [r] = await authDb
    .select({ c: count() })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), gt(verificationTokens.expires, new Date(now))));
  return Number(r?.c ?? 0);
}

export type VerifyLoginCode = { ok: true; userId: string } | { ok: false; reason: 'noCode' | 'wrongCode' | 'locked' };

/** Check a code for an address. Spends the code on success. */
export async function verifyLoginCode(rawEmail: string, rawCode: string, now = Date.now()): Promise<VerifyLoginCode> {
  const u = await userIdFor(rawEmail);
  if (!u) return { ok: false, reason: 'noCode' };
  const [stored] = await authDb
    .select({ token: verificationTokens.token })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, codeId(u.id)), gt(verificationTokens.expires, new Date(now))))
    .limit(1);
  if (!stored) return { ok: false, reason: 'noCode' };

  await authDb
    .insert(verificationTokens)
    .values({ identifier: failId(u.id), token: randomUUID(), expires: new Date(now + LOGIN_CODE_TTL_MS) });
  if ((await liveCount(failId(u.id), now)) > LOGIN_CODE_MAX_ATTEMPTS) {
    await authDb.delete(verificationTokens).where(eq(verificationTokens.identifier, codeId(u.id)));
    return { ok: false, reason: 'locked' };
  }

  const code = String(rawCode ?? '').replace(/\D/g, '');
  const expected = Buffer.from(stored.token, 'hex');
  const given = Buffer.from(code.length === 6 ? loginCodeDigest(u.id, code) : '00', 'hex');
  if (!(expected.length === given.length && timingSafeEqual(expected, given))) return { ok: false, reason: 'wrongCode' };

  await authDb.delete(verificationTokens).where(inArray(verificationTokens.identifier, [codeId(u.id), failId(u.id)]));
  // A code proves the mailbox, like a magic link: mark the address verified.
  await authDb.update(users).set({ emailVerified: new Date(now) }).where(eq(users.id, u.id));
  return { ok: true, userId: u.id };
}
