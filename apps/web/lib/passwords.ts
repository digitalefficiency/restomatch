import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, passwordResetTokens, sql, userCredentials, users } from '@restomatch/db';
import { hashPassword, needsRehash, verifyPassword } from '@restomatch/crypto';
import { authDb } from './authDb';

/**
 * Server-only credential lifecycle for Epic B (password as primary auth).
 *
 * EVERYTHING here runs on the OWNER auth connection (authDb) — the tenant app
 * role is REVOKE'd on user_credentials / password_reset_tokens (see
 * packages/db/src/rls.ts). argon2id (@restomatch/crypto) is node-runtime only;
 * this module carries `import 'server-only'` so it can never be pulled into the
 * edge bundle (middleware / auth.config). The Credentials provider in auth.ts is
 * the only caller of authorizeCredentials().
 */

/** The address as typed, trimmed + lower-cased — for the unique users.email lookup. */
export function normalizeLoginEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/* ── DB lockout backstop (C.2) ───────────────────────────────────────────────
 * Durable, Redis-independent: the Redis limiter fails OPEN on an outage, so the
 * real brute-force ceiling lives in user_credentials. After N consecutive
 * failures the account is locked for an exponentially growing window; a correct
 * password DURING the lock is still rejected (uniformly, never revealing the
 * lock); a success resets the counter.
 */
export const MAX_FAILED_BEFORE_LOCK = 5;
const LOCK_BASE_MS = 60 * 1000; // 1 minute
const LOCK_MAX_MS = 30 * 60 * 1000; // capped at 30 minutes

/** Lock window for a given (post-increment) consecutive-failure count. */
export function lockDurationMs(failedCount: number): number {
  if (failedCount < MAX_FAILED_BEFORE_LOCK) return 0;
  const over = failedCount - MAX_FAILED_BEFORE_LOCK;
  return Math.min(LOCK_BASE_MS * 2 ** over, LOCK_MAX_MS);
}

/* ── Reset-token policy (B.4) ────────────────────────────────────────────── */
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A real argon2id hash of a random secret, computed once. Verifying a supplied
 * password against it when the user / credential row is absent equalises the
 * authorize() timing so a wrong-email and a wrong-password are
 * indistinguishable (no user enumeration via response time).
 */
let dummyHashPromise: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(24).toString('hex'));
  return dummyHashPromise;
}

export interface AuthorizedUser {
  id: string;
  email: string;
  name: string | null;
  /** True when the user has 2FA enrolled — the session must stay pending (Epic C). */
  twoFactorPending: boolean;
}

/**
 * Verify an email+password against the stored argon2id hash on the owner auth
 * connection. Returns a UNIFORM `null` for every failure mode (unknown user, no
 * password set, wrong password, unverified email, locked account) so the
 * response never leaks which one occurred. Applies + maintains the DB lockout
 * backstop and transparently re-hashes when the argon2 cost parameters change.
 */
export async function authorizeCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthorizedUser | null> {
  const email = normalizeLoginEmail(input.email);
  const password = input.password;
  if (!email || !password) {
    // Still burn one verify so empty input is not a timing oracle.
    await verifyPassword(await dummyHash(), password || 'x');
    return null;
  }

  const [user] = await authDb
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    await verifyPassword(await dummyHash(), password);
    return null;
  }

  const [cred] = await authDb
    .select({
      passwordHash: userCredentials.passwordHash,
      failedLoginCount: userCredentials.failedLoginCount,
      lockedUntil: userCredentials.lockedUntil,
      totpEnabledAt: userCredentials.totpEnabledAt,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, user.id))
    .limit(1);

  if (!cred || !cred.passwordHash) {
    await verifyPassword(await dummyHash(), password);
    return null;
  }

  const now = Date.now();
  const locked = cred.lockedUntil != null && cred.lockedUntil.getTime() > now;

  const ok = await verifyPassword(cred.passwordHash, password);

  // A correct password DURING an active lock is still rejected — and we do NOT
  // reset the counter, so the lock runs its full course.
  if (locked) return null;

  if (!ok) {
    const nextCount = cred.failedLoginCount + 1;
    const dur = lockDurationMs(nextCount);
    await authDb
      .update(userCredentials)
      .set({
        failedLoginCount: nextCount,
        lockedUntil: dur > 0 ? new Date(now + dur) : cred.lockedUntil,
        updatedAt: new Date(now),
      })
      .where(eq(userCredentials.userId, user.id));
    return null;
  }

  // Correct password — clear the lockout counters regardless of what follows.
  await authDb
    .update(userCredentials)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date(now) })
    .where(eq(userCredentials.userId, user.id));

  // emailVerified gate (B.6): a correct password is NOT enough if the address
  // was never verified — and we return the SAME null so it is indistinguishable
  // from a wrong password.
  if (!user.emailVerified) return null;

  // Transparent rehash if the cost params were raised since this hash was made.
  if (needsRehash(cred.passwordHash)) {
    try {
      const fresh = await hashPassword(password);
      await authDb
        .update(userCredentials)
        .set({ passwordHash: fresh, passwordUpdatedAt: new Date(now), updatedAt: new Date(now) })
        .where(eq(userCredentials.userId, user.id));
    } catch {
      // Rehash is best-effort; never block a valid login on it.
    }
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorPending: cred.totpEnabledAt != null,
  };
}

/* ── Session-security state for the JWT callback (B.2 / C session-gate) ────── */

export interface SessionSecurityState {
  tokenVersion: number;
  twoFactorEnabled: boolean;
}

/** Whether the user already has a password set (drives set vs. change UI). */
export async function hasPassword(userId: string): Promise<boolean> {
  const [row] = await authDb
    .select({ passwordHash: userCredentials.passwordHash })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return Boolean(row?.passwordHash);
}

/** Current tokenVersion + 2FA-enrolled flag for a user (defaults for no row). */
export async function getSessionSecurityState(userId: string): Promise<SessionSecurityState> {
  const [row] = await authDb
    .select({
      tokenVersion: userCredentials.tokenVersion,
      totpEnabledAt: userCredentials.totpEnabledAt,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return {
    tokenVersion: row?.tokenVersion ?? 0,
    twoFactorEnabled: row?.totpEnabledAt != null,
  };
}

/* ── Password mutations (B.4) ────────────────────────────────────────────── */

/** Upsert a user's password hash. Does NOT bump tokenVersion (first set-up). */
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const hash = await hashPassword(newPassword);
  const now = new Date();
  await authDb
    .insert(userCredentials)
    .values({ userId, passwordHash: hash, passwordUpdatedAt: now })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: { passwordHash: hash, passwordUpdatedAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now },
    });
}

/**
 * Change a user's password after verifying the CURRENT one, and bump
 * tokenVersion so every other live session is revoked. Returns false (without
 * changing anything) when the current password is wrong / unset.
 */
export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const [cred] = await authDb
    .select({ passwordHash: userCredentials.passwordHash })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  if (!cred?.passwordHash) return false;
  if (!(await verifyPassword(cred.passwordHash, currentPassword))) return false;

  const hash = await hashPassword(newPassword);
  const now = new Date();
  await authDb
    .update(userCredentials)
    .set({
      passwordHash: hash,
      passwordUpdatedAt: now,
      tokenVersion: sql`${userCredentials.tokenVersion} + 1`,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(userCredentials.userId, userId));
  return true;
}

/**
 * "Log out everywhere": bump tokenVersion so every JWT minted before now fails
 * the version comparison in the auth.ts jwt callback on its next revalidation.
 */
export async function bumpTokenVersion(userId: string): Promise<number> {
  const now = new Date();
  const [row] = await authDb
    .insert(userCredentials)
    .values({ userId, tokenVersion: 1 })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: { tokenVersion: sql`${userCredentials.tokenVersion} + 1`, updatedAt: now },
    })
    .returning({ tokenVersion: userCredentials.tokenVersion });
  return row?.tokenVersion ?? 1;
}

/* ── Reset via emailed token (B.4) ───────────────────────────────────────── */

/**
 * Create a one-time reset token for the (verified) mailbox and return the RAW
 * token (only its sha256 is stored). Returns null when no such user exists — the
 * caller MUST respond identically either way (no account enumeration).
 */
export async function requestPasswordReset(email: string): Promise<{ rawToken: string } | null> {
  const normalized = normalizeLoginEmail(email);
  const [user] = await authDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  if (!user) return null;

  const rawToken = generateRawToken();
  await authDb.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256Hex(rawToken),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return { rawToken };
}

/**
 * Consume a reset token: verify it is unused + unexpired, set the new password,
 * mark the address verified, and BUMP tokenVersion (kills every live session).
 * Returns false for an unknown / used / expired token.
 */
export async function resetPasswordWithToken(
  rawToken: string,
  newPassword: string,
): Promise<boolean> {
  if (!rawToken || !newPassword) return false;
  const tokenHash = sha256Hex(rawToken);
  const now = new Date();

  const [tok] = await authDb
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId, expiresAt: passwordResetTokens.expiresAt })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
    .limit(1);
  if (!tok || tok.expiresAt.getTime() <= now.getTime()) return false;

  const hash = await hashPassword(newPassword);
  await authDb
    .insert(userCredentials)
    .values({ userId: tok.userId, passwordHash: hash, passwordUpdatedAt: now, tokenVersion: 1 })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      set: {
        passwordHash: hash,
        passwordUpdatedAt: now,
        tokenVersion: sql`${userCredentials.tokenVersion} + 1`,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: now,
      },
    });
  // Receiving the reset link proves mailbox ownership → safe to mark verified.
  await authDb.update(users).set({ emailVerified: now }).where(eq(users.id, tok.userId));
  // One-time: burn the token so a replay / leak is inert.
  await authDb
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(eq(passwordResetTokens.id, tok.id));
  return true;
}
