import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
} from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import {
  and,
  eq,
  gt,
  isNull,
  lt,
  or,
  userCredentials,
  userRecoveryCodes,
} from '@restomatch/db';
import { authDb } from './authDb';
import {
  clearFailedAttempts,
  lockDurationMs,
  registerFailedAttempt,
} from './passwords';

/**
 * Server-only TOTP (2FA) for Epic C.
 *
 * EVERYTHING here runs on the OWNER auth connection (authDb) — the tenant app
 * role is REVOKE'd on user_credentials / user_recovery_codes (packages/db/rls).
 * otplib + qrcode are pure-JS (no native build); node:crypto AES-256-GCM
 * encrypts the TOTP secret at rest with AUTH_ENC_KEY (the column never stores
 * plaintext). `import 'server-only'` keeps this out of the edge bundle so it can
 * never be pulled into middleware / auth.config.
 *
 * The 2FA enforcement is a SESSION-layer gate (see auth.ts / middleware.ts), NOT
 * a check inside one provider's authorize() — so a magic-link FIRST factor still
 * requires the TOTP second factor exactly like a password login does.
 */

const ISSUER = 'RestoMatch';

// ±1 time-step window (a step is 30s): tolerates clock skew + submit latency
// without widening the brute-force surface beyond the standard recommendation.
authenticator.options = { window: 1 };

const RECOVERY_CODE_COUNT = 10;
/** A verified second factor must be redeemed into the session within this window. */
const TICKET_TTL_MS = 3 * 60 * 1000;

/* ── AES-256-GCM envelope for the TOTP secret (AUTH_ENC_KEY) ───────────────── */

function encKey(): Buffer {
  const raw = process.env.AUTH_ENC_KEY;
  if (!raw) {
    throw new Error('AUTH_ENC_KEY is required to encrypt/decrypt the TOTP secret');
  }
  // Accept a 32-byte hex key, a 32-byte base64 key, or any sufficiently-long
  // passphrase (folded to 32 bytes via sha256) so operators are not forced into
  // a specific encoding. The result is always a 256-bit key.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** AES-256-GCM encrypt → `v1:<iv>:<tag>:<ciphertext>` (all base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

/** Inverse of {@link encryptSecret}. Throws on tamper (GCM auth tag mismatch). */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('malformed totp ciphertext');
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const enc = Buffer.from(parts[3]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/* ── Code verification ─────────────────────────────────────────────────────── */

// TOTP period in seconds. otplib's default step is 30s (options.step is left at
// its default above), so the time-step index is floor(epochSeconds / 30).
const TOTP_PERIOD_SEC = 30;

/**
 * The time-step a token validates against, or null when it doesn't match within
 * the ±1-step window. The step = floor(now/period) + the matched delta
 * (-1 / 0 / +1), so it uniquely identifies WHICH 30s step a code belongs to —
 * the value the caller records to make each code one-time-use (RFC 6238 §5.2).
 * Never throws.
 */
export function matchTotpStep(secret: string, token: string): number | null {
  const t = (token ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(t)) return null;
  try {
    // checkDelta returns the offset of the matching step (or null), unlike
    // verify() which only returns a boolean — we need the offset to derive step.
    const delta = authenticator.checkDelta(t, secret);
    if (delta == null) return null;
    return Math.floor(Date.now() / 1000 / TOTP_PERIOD_SEC) + delta;
  } catch {
    return null;
  }
}

/** Verify a 6-digit TOTP token against a base32 secret (±1 step). Never throws. */
export function verifyTotp(secret: string, token: string): boolean {
  return matchTotpStep(secret, token) !== null;
}

const sha256Hex = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** Recovery codes are case-insensitive and dash-insensitive on input. */
function normalizeRecoveryCode(raw: string): string {
  return (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ── Enrollment ────────────────────────────────────────────────────────────── */

export interface EnrollmentChallenge {
  /** Base32 secret — shown for manual entry into the authenticator app. */
  secret: string;
  /** otpauth:// URI encoded for QR scanning. */
  otpauthUri: string;
  /** PNG data URL of the QR for the otpauth URI. */
  qrDataUrl: string;
}

/** Thrown when enrollment is attempted while 2FA is already armed (must disable first). */
export class TwoFactorAlreadyEnabledError extends Error {
  constructor() {
    super('two_factor_already_enabled');
    this.name = 'TwoFactorAlreadyEnabledError';
  }
}

/**
 * Begin enrollment: generate + STORE the encrypted secret but DO NOT arm 2FA
 * (totpEnabledAt stays null). An abandoned enrollment therefore leaves the
 * session gate inert. Returns the QR / secret for the confirm step.
 *
 * SECURITY (2FA re-enroll bypass): this must NEVER silently disarm an already-
 * armed 2FA — otherwise a caller with only the FIRST factor could overwrite the
 * secret with one they control (set totpEnabledAt=null + a new secret), confirm
 * it, and take over the second factor. So enrollment is REFUSED when 2FA is
 * already armed: replacing it requires an explicit disableTwoFactor() first,
 * which re-authenticates with the CURRENT second factor. The refusal is enforced
 * twice — a pre-read (clear error) AND a `setWhere` that only writes when
 * totp_enabled_at IS NULL (race-safe: a concurrent arm can never be clobbered).
 */
export async function startTotpEnrollment(
  userId: string,
  accountLabel: string,
): Promise<EnrollmentChallenge> {
  const [existing] = await authDb
    .select({ totpEnabledAt: userCredentials.totpEnabledAt })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  if (existing?.totpEnabledAt != null) throw new TwoFactorAlreadyEnabledError();

  const secret = authenticator.generateSecret();
  const otpauthUri = authenticator.keyuri(accountLabel || userId, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri);
  const secretEnc = encryptSecret(secret);
  const now = new Date();
  await authDb
    .insert(userCredentials)
    .values({ userId, totpSecretEnc: secretEnc })
    .onConflictDoUpdate({
      target: userCredentials.userId,
      // Re-starting enrollment replaces any half-finished (un-armed) secret and
      // also clears any stale replay marker for the new secret. The setWhere
      // guard makes this a no-op against an ALREADY-ARMED row, so a live 2FA can
      // never be disarmed here even under a race; the pre-read above is the
      // common-case clear error. In the (impossible-in-practice) self-race where
      // the row armed between the read and this write, the write no-ops and
      // confirmTotpEnrollment then refuses (it sees totpEnabledAt != null) — so
      // enrollment fails safe, it never replaces a live secret.
      set: { totpSecretEnc: secretEnc, totpEnabledAt: null, totpLastStep: null, updatedAt: now },
      setWhere: isNull(userCredentials.totpEnabledAt),
    });
  return { secret, otpauthUri, qrDataUrl };
}

/**
 * Confirm enrollment: verify a code against the pending secret, ARM 2FA
 * (totpEnabledAt), and issue a fresh set of recovery codes (returned ONCE — only
 * their hashes are stored). Returns null when the code is wrong / no pending
 * secret exists.
 */
export async function confirmTotpEnrollment(
  userId: string,
  token: string,
): Promise<{ recoveryCodes: string[] } | null> {
  const [cred] = await authDb
    .select({
      totpSecretEnc: userCredentials.totpSecretEnc,
      totpEnabledAt: userCredentials.totpEnabledAt,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  if (!cred?.totpSecretEnc) return null;
  // Already enrolled? Confirming again would silently rotate recovery codes;
  // require an explicit disable→re-enroll instead.
  if (cred.totpEnabledAt != null) return null;

  const secret = decryptSecret(cred.totpSecretEnc);
  if (!verifyTotp(secret, token)) return null;

  const now = new Date();
  await authDb
    .update(userCredentials)
    // Arm 2FA but DO NOT record a consumed step here: enrollment confirmation is a
    // distinct one-shot proof-of-possession in an already-authenticated settings
    // session, separate from the login second factor. Recording it would reject a
    // legitimate /login/2fa (or disable) that lands in the same 30s window with a
    // freshly-generated code for the same step. The one-time-use replay guard
    // (RFC 6238 §5.2) is enforced where it matters — verifySecondFactor. The fresh
    // secret starts with totp_last_step = NULL (cleared by startTotpEnrollment).
    .set({ totpEnabledAt: now, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
    .where(eq(userCredentials.userId, userId));
  const recoveryCodes = await issueRecoveryCodes(userId);
  return { recoveryCodes };
}

/** Whether the user has 2FA armed (totpEnabledAt set). */
export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  const [cred] = await authDb
    .select({ totpEnabledAt: userCredentials.totpEnabledAt })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return cred?.totpEnabledAt != null;
}

/* ── Recovery codes ────────────────────────────────────────────────────────── */

function generateRecoveryCode(): string {
  // 10 lowercase base32 chars (Crockford-ish, no 0/1/o/l), grouped as xxxxx-xxxxx.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[randomInt(alphabet.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Replace the user's recovery codes with a fresh set; return the plaintext once. */
async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await authDb.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  await authDb.insert(userRecoveryCodes).values(
    codes.map((c) => ({ userId, codeHash: sha256Hex(normalizeRecoveryCode(c)) })),
  );
  return codes;
}

/**
 * Atomically consume one unused recovery code. The UPDATE ... WHERE used_at IS
 * NULL makes redemption one-time even under a race: only the row that was still
 * unused is stamped, and a returned row proves THIS call won it.
 */
async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return false;
  const codeHash = sha256Hex(normalized);
  const updated = await authDb
    .update(userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userRecoveryCodes.userId, userId),
        eq(userRecoveryCodes.codeHash, codeHash),
        isNull(userRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: userRecoveryCodes.id });
  return updated.length > 0;
}

/** Count of recovery codes still unused (shown in settings). */
export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const rows = await authDb
    .select({ id: userRecoveryCodes.id })
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
  return rows.length;
}

/* ── Second-factor verification (TOTP OR recovery) + DB lockout backstop ────── */

export type SecondFactorStatus = 'ok' | 'invalid' | 'locked' | 'not_enrolled';

/**
 * Verify a second factor for a 2FA-enrolled user: a 6-digit TOTP token (±1
 * step) OR a one-time recovery code. Enforces the durable, Redis-independent
 * lockout backstop (C.2) on the SAME failedLoginCount / lockedUntil columns as
 * the password login — so a brute force on the TOTP step also locks the account
 * even if the Redis limiter is failing open. Returns a coarse status; the caller
 * surfaces a single uniform message that never reveals the lock state.
 */
export async function verifySecondFactor(
  userId: string,
  code: string,
): Promise<SecondFactorStatus> {
  const [cred] = await authDb
    .select({
      totpSecretEnc: userCredentials.totpSecretEnc,
      totpEnabledAt: userCredentials.totpEnabledAt,
      failedLoginCount: userCredentials.failedLoginCount,
      lockedUntil: userCredentials.lockedUntil,
    })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);

  if (!cred?.totpEnabledAt || !cred.totpSecretEnc) return 'not_enrolled';

  // Locked → reject WITHOUT consuming a code and without resetting the counter,
  // so the lock runs its full course (mirrors the password path).
  if (cred.lockedUntil != null && cred.lockedUntil.getTime() > Date.now()) {
    return 'locked';
  }

  const secret = decryptSecret(cred.totpSecretEnc);
  const step = matchTotpStep(secret, code);

  if (step !== null) {
    // A structurally-valid TOTP. Enforce one-time-use per step (RFC 6238 §5.2):
    // atomically advance totp_last_step ONLY when this step is newer than the
    // last consumed one. A replay of a code whose step was already burned matches
    // 0 rows ⇒ it is treated as a failed attempt below (NOT accepted). The same
    // conditional UPDATE makes two concurrent submissions of one fresh code
    // race-safe — exactly one wins the row. A success also clears the lockout.
    const now = new Date();
    const advanced = await authDb
      .update(userCredentials)
      .set({ totpLastStep: step, failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(
        and(
          eq(userCredentials.userId, userId),
          or(isNull(userCredentials.totpLastStep), lt(userCredentials.totpLastStep, step)),
        ),
      )
      .returning({ userId: userCredentials.userId });
    if (advanced.length > 0) return 'ok';
    // else: this TOTP step was already consumed (replay) → fall through.
  }

  // Not a fresh TOTP (wrong/replayed code) → try a one-time recovery code.
  if (await consumeRecoveryCode(userId, code)) {
    await clearFailedAttempts(userId);
    return 'ok';
  }

  await registerFailedAttempt(userId, cred.failedLoginCount, cred.lockedUntil);
  return 'invalid';
}

/** Lock window (ms) a given consecutive-failure count would arm — for UI hints. */
export function lockoutWindowMsFor(failedCount: number): number {
  return lockDurationMs(failedCount);
}

/* ── Second-factor "pass ticket" (clears twoFactorPending in the JWT) ───────── */

/**
 * Mint a one-time, short-lived ticket after a SUCCESSFUL second factor. Only
 * sha256(nonce) is stored; the raw nonce is handed to the Auth.js session update
 * and re-validated by the jwt callback. The client never sees the hash and
 * cannot forge the nonce, so a direct POST to the session-update endpoint cannot
 * clear twoFactorPending without a real second factor.
 */
export async function issueTwoFactorTicket(userId: string): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  const now = Date.now();
  await authDb
    .update(userCredentials)
    .set({
      twoFactorTicketHash: sha256Hex(nonce),
      twoFactorTicketExpires: new Date(now + TICKET_TTL_MS),
      updatedAt: new Date(now),
    })
    .where(eq(userCredentials.userId, userId));
  return nonce;
}

/**
 * Validate + burn a 2FA pass ticket (one-time, unexpired). Returns true exactly
 * once per issued ticket. Called from the jwt callback on an Auth.js session
 * update to clear twoFactorPending.
 */
export async function consumeTwoFactorTicket(userId: string, nonce: string): Promise<boolean> {
  if (!nonce) return false;
  const now = new Date();
  const rows = await authDb
    .update(userCredentials)
    .set({ twoFactorTicketHash: null, twoFactorTicketExpires: null, updatedAt: now })
    .where(
      and(
        eq(userCredentials.userId, userId),
        eq(userCredentials.twoFactorTicketHash, sha256Hex(nonce)),
        gt(userCredentials.twoFactorTicketExpires, now),
      ),
    )
    .returning({ userId: userCredentials.userId });
  return rows.length > 0;
}

/* ── Disable (requires re-auth via a current second factor) ─────────────────── */

/**
 * Disable 2FA. Requires re-auth: a CURRENT valid second factor (TOTP or a
 * recovery code) — proving the disabler still controls the factor being removed.
 * Clears the secret, the enrolled flag, every recovery code, and any pending
 * ticket. Returns false (and changes nothing) on a bad code / a locked account.
 */
export async function disableTwoFactor(userId: string, code: string): Promise<boolean> {
  const status = await verifySecondFactor(userId, code);
  if (status !== 'ok') return false;
  const now = new Date();
  await authDb
    .update(userCredentials)
    .set({
      totpSecretEnc: null,
      totpEnabledAt: null,
      twoFactorTicketHash: null,
      twoFactorTicketExpires: null,
      updatedAt: now,
    })
    .where(eq(userCredentials.userId, userId));
  await authDb.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  return true;
}
