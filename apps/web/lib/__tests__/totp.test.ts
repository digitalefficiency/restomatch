import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import {
  applyAuthCredentialTables,
  createDb,
  eq,
  inArray,
  userCredentials,
  userRecoveryCodes,
  users,
  type Database,
} from '@restomatch/db';
import { getSessionSecurityState, setUserPassword, MAX_FAILED_BEFORE_LOCK } from '../passwords';
import {
  confirmTotpEnrollment,
  consumeTwoFactorTicket,
  countUnusedRecoveryCodes,
  decryptSecret,
  disableTwoFactor,
  encryptSecret,
  isTwoFactorEnabled,
  issueTwoFactorTicket,
  startTotpEnrollment,
  verifySecondFactor,
  verifyTotp,
} from '../totp';

/**
 * DB-backed 2FA (TOTP) tests for Epic C. They run lib/totp against the REAL
 * owner auth connection (lib/authDb → DATABASE_URL = the test DB) with a
 * throwaway AUTH_ENC_KEY (vitest.config.ts). The lockout backstop exercised here
 * uses NO Redis — it is the durable, Redis-independent ceiling on the TOTP path
 * (C.2), mirroring the password path.
 */

const TEST_DB =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const ownerDb: Database = createDb(TEST_DB);

// Match the verifier's ±1-step tolerance when minting tokens in tests.
authenticator.options = { window: 1 };

const created: string[] = [];
let seq = 0;

async function makeUser(): Promise<{ id: string; email: string }> {
  const email = `totptest-${Date.now()}-${seq++}@restaurant.example`;
  const [row] = await ownerDb
    .insert(users)
    .values({ email, emailVerified: new Date() })
    .returning({ id: users.id });
  created.push(row!.id);
  return { id: row!.id, email };
}

async function readCred(userId: string) {
  const [c] = await ownerDb
    .select()
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);
  return c;
}

/** Enroll a fresh user and return the plaintext secret (to mint valid tokens). */
async function enroll(userId: string): Promise<string> {
  const ch = await startTotpEnrollment(userId, 'x@y.z');
  const ok = await confirmTotpEnrollment(userId, authenticator.generate(ch.secret));
  expect(ok).not.toBeNull();
  return ch.secret;
}

beforeAll(async () => {
  // The shared test DB is push-based (no migration journal). Guarantee the
  // credential tables + the 0020 ticket columns exist before these tests run,
  // independent of which other suite happened to (re)create them first.
  await applyAuthCredentialTables(TEST_DB);
});

afterAll(async () => {
  if (created.length) {
    await ownerDb.delete(users).where(inArray(users.id, created));
  }
});

describe('AES-256-GCM secret envelope', () => {
  it('round-trips and never stores plaintext', () => {
    const secret = authenticator.generateSecret();
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV) but the same plaintext', () => {
    const enc1 = encryptSecret('ABCDEFGH');
    const enc2 = encryptSecret('ABCDEFGH');
    expect(enc1).not.toBe(enc2);
    expect(decryptSecret(enc1)).toBe('ABCDEFGH');
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const enc = encryptSecret('TAMPERME');
    const parts = enc.split(':');
    // Flip the last char of the ciphertext segment.
    const last = parts[3]!;
    parts[3] = last.slice(0, -1) + (last.endsWith('A') ? 'B' : 'A');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});

describe('verifyTotp (±1 step)', () => {
  it('accepts the current token and rejects malformed / wrong codes', () => {
    const secret = authenticator.generateSecret();
    expect(verifyTotp(secret, authenticator.generate(secret))).toBe(true);
    expect(verifyTotp(secret, '12345')).toBe(false); // too short
    expect(verifyTotp(secret, 'abcdef')).toBe(false); // not digits
    expect(verifyTotp(secret, '')).toBe(false);
  });
});

describe('enrollment', () => {
  it('start stores ciphertext (not the base32 secret) and leaves 2FA disarmed', async () => {
    const u = await makeUser();
    const ch = await startTotpEnrollment(u.id, u.email);
    expect(ch.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const cred = await readCred(u.id);
    expect(cred?.totpSecretEnc).toBeTruthy();
    expect(cred?.totpSecretEnc).not.toContain(ch.secret); // encrypted at rest
    expect(cred?.totpEnabledAt).toBeNull(); // not armed until confirmed
    expect(await isTwoFactorEnabled(u.id)).toBe(false);
  });

  it('confirm with a valid code arms 2FA and issues 10 one-time recovery codes', async () => {
    const u = await makeUser();
    const ch = await startTotpEnrollment(u.id, u.email);
    const res = await confirmTotpEnrollment(u.id, authenticator.generate(ch.secret));
    expect(res?.recoveryCodes).toHaveLength(10);
    expect(await isTwoFactorEnabled(u.id)).toBe(true);
    expect(await countUnusedRecoveryCodes(u.id)).toBe(10);
    // Only hashes are stored — no plaintext recovery code in the table.
    const stored = await ownerDb
      .select({ codeHash: userRecoveryCodes.codeHash })
      .from(userRecoveryCodes)
      .where(eq(userRecoveryCodes.userId, u.id));
    for (const row of stored) {
      expect(res!.recoveryCodes).not.toContain(row.codeHash);
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('confirm with a wrong code does not arm 2FA', async () => {
    const u = await makeUser();
    await startTotpEnrollment(u.id, u.email);
    expect(await confirmTotpEnrollment(u.id, '000000')).toBeNull();
    expect(await isTwoFactorEnabled(u.id)).toBe(false);
  });
});

describe('verifySecondFactor — TOTP, recovery, and lockout backstop', () => {
  it('accepts a valid TOTP token', async () => {
    const u = await makeUser();
    const secret = await enroll(u.id);
    expect(await verifySecondFactor(u.id, authenticator.generate(secret))).toBe('ok');
  });

  it('accepts a recovery code exactly once (one-time)', async () => {
    const u = await makeUser();
    const ch = await startTotpEnrollment(u.id, u.email);
    const res = await confirmTotpEnrollment(u.id, authenticator.generate(ch.secret));
    const code = res!.recoveryCodes[0]!;
    expect(await verifySecondFactor(u.id, code)).toBe('ok');
    // Re-use is rejected (it was burned).
    expect(await verifySecondFactor(u.id, code)).toBe('invalid');
    expect(await countUnusedRecoveryCodes(u.id)).toBe(9);
  });

  it('returns not_enrolled when 2FA is not armed', async () => {
    const u = await makeUser();
    expect(await verifySecondFactor(u.id, '123456')).toBe('not_enrolled');
  });

  it('locks after N failures and rejects a CORRECT token during the lock (Redis-independent)', async () => {
    const u = await makeUser();
    const secret = await enroll(u.id);
    for (let i = 0; i < MAX_FAILED_BEFORE_LOCK; i++) {
      expect(await verifySecondFactor(u.id, 'zzzzzz')).toBe('invalid');
    }
    const cred = await readCred(u.id);
    expect(cred?.failedLoginCount).toBeGreaterThanOrEqual(MAX_FAILED_BEFORE_LOCK);
    expect(cred?.lockedUntil).not.toBeNull();
    expect(cred!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // A correct token while locked is STILL rejected (uniform 'locked').
    expect(await verifySecondFactor(u.id, authenticator.generate(secret))).toBe('locked');
  });

  it('a success resets the failure counter', async () => {
    const u = await makeUser();
    const secret = await enroll(u.id);
    await verifySecondFactor(u.id, 'zzzzzz');
    await verifySecondFactor(u.id, 'zzzzzz');
    expect((await readCred(u.id))?.failedLoginCount).toBe(2);
    expect(await verifySecondFactor(u.id, authenticator.generate(secret))).toBe('ok');
    const cred = await readCred(u.id);
    expect(cred?.failedLoginCount).toBe(0);
    expect(cred?.lockedUntil).toBeNull();
  });
});

describe('second-factor pass ticket (clears the JWT 2FA gate)', () => {
  it('is one-time and rejects a bogus / expired nonce', async () => {
    const u = await makeUser();
    await enroll(u.id);
    const nonce = await issueTwoFactorTicket(u.id);
    expect(await consumeTwoFactorTicket(u.id, 'not-the-nonce')).toBe(false);
    expect(await consumeTwoFactorTicket(u.id, nonce)).toBe(true);
    // Burned — a replay fails.
    expect(await consumeTwoFactorTicket(u.id, nonce)).toBe(false);
  });

  it('rejects an expired ticket', async () => {
    const u = await makeUser();
    await enroll(u.id);
    const nonce = await issueTwoFactorTicket(u.id);
    await ownerDb
      .update(userCredentials)
      .set({ twoFactorTicketExpires: new Date(Date.now() - 1000) })
      .where(eq(userCredentials.userId, u.id));
    expect(await consumeTwoFactorTicket(u.id, nonce)).toBe(false);
  });
});

describe('disable requires a current second factor (re-auth)', () => {
  it('rejects a wrong code and clears everything on a valid one', async () => {
    const u = await makeUser();
    const secret = await enroll(u.id);
    expect(await disableTwoFactor(u.id, '000000')).toBe(false);
    expect(await isTwoFactorEnabled(u.id)).toBe(true);

    expect(await disableTwoFactor(u.id, authenticator.generate(secret))).toBe(true);
    expect(await isTwoFactorEnabled(u.id)).toBe(false);
    const cred = await readCred(u.id);
    expect(cred?.totpSecretEnc).toBeNull();
    expect(await countUnusedRecoveryCodes(u.id)).toBe(0);
  });
});

describe('session-layer gate (magic-link ALSO requires the second factor)', () => {
  it('a 2FA-enrolled user reports twoFactorEnabled regardless of first-factor type', async () => {
    const u = await makeUser();
    // A magic-link-only user (no password) who enrolls 2FA.
    await enroll(u.id);
    // getSessionSecurityState is what the jwt callback reads for BOTH factors —
    // so a magic-link FIRST factor still leaves the session pending.
    expect((await getSessionSecurityState(u.id)).twoFactorEnabled).toBe(true);

    // Add a password too — the gate is independent of the first factor.
    await setUserPassword(u.id, 'password-and-totp-123');
    expect((await getSessionSecurityState(u.id)).twoFactorEnabled).toBe(true);
  });
});
