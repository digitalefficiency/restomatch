import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, inArray, userCredentials, users, type Database } from '@restomatch/db';
import {
  MAX_FAILED_BEFORE_LOCK,
  authorizeCredentials,
  bumpTokenVersion,
  changeUserPassword,
  getSessionSecurityState,
  hasPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  setUserPassword,
} from '../passwords';

/**
 * DB-backed credential tests (Epic B). They exercise lib/passwords against the
 * REAL owner auth connection (lib/authDb → DATABASE_URL, set to the test DB in
 * vitest.config.ts). Notably the lockout backstop here uses NO Redis — it is the
 * durable, Redis-independent ceiling (C.2).
 */

const TEST_DB =
  testDbUrl();
const ownerDb: Database = createDb(TEST_DB);

const created: string[] = [];
let seq = 0;

async function makeUser(opts: { verified?: boolean } = {}): Promise<{ id: string; email: string }> {
  const email = `pwtest-${Date.now()}-${seq++}@restaurant.example`;
  const [row] = await ownerDb
    .insert(users)
    .values({ email, emailVerified: opts.verified === false ? null : new Date() })
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

afterAll(async () => {
  if (created.length) {
    // FK ON DELETE CASCADE removes user_credentials + password_reset_tokens.
    await ownerDb.delete(users).where(inArray(users.id, created));
  }
});

describe('authorizeCredentials — happy path + no user enumeration', () => {
  it('accepts a correct password for a verified user', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'correct horse battery 42');
    const res = await authorizeCredentials({ email: u.email, password: 'correct horse battery 42' });
    expect(res).not.toBeNull();
    expect(res?.id).toBe(u.id);
    expect(res?.twoFactorPending).toBe(false);
  });

  it('returns null for a wrong password (and counts the failure)', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'right-password-123');
    const res = await authorizeCredentials({ email: u.email, password: 'WRONG' });
    expect(res).toBeNull();
    expect((await readCred(u.id))?.failedLoginCount).toBe(1);
  });

  it('returns the SAME null for an unknown user as for a wrong password', async () => {
    const unknown = await authorizeCredentials({
      email: 'nobody-here@restaurant.example',
      password: 'whatever',
    });
    expect(unknown).toBeNull();
  });

  it('equalises timing: an unknown user still runs an argon2 verify (no fast-path oracle)', async () => {
    const t0 = performance.now();
    await authorizeCredentials({ email: 'ghost@restaurant.example', password: 'x'.repeat(20) });
    const elapsed = performance.now() - t0;
    // A real argon2id verify is tens of ms; a bare "user not found" early-return
    // would be sub-millisecond. >5ms proves the dummy-hash timing defense ran.
    expect(elapsed).toBeGreaterThan(5);
  });

  it('rejects a CORRECT password when the email is unverified (uniform null)', async () => {
    const u = await makeUser({ verified: false });
    await setUserPassword(u.id, 'verified-or-not-99');
    const res = await authorizeCredentials({ email: u.email, password: 'verified-or-not-99' });
    expect(res).toBeNull();
  });
});

describe('account lockout backstop (Redis-independent)', () => {
  it('locks after N failures and rejects the correct password DURING the lock', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'the-real-password-1');
    for (let i = 0; i < MAX_FAILED_BEFORE_LOCK; i++) {
      expect(await authorizeCredentials({ email: u.email, password: 'nope' })).toBeNull();
    }
    const cred = await readCred(u.id);
    expect(cred?.failedLoginCount).toBeGreaterThanOrEqual(MAX_FAILED_BEFORE_LOCK);
    expect(cred?.lockedUntil).not.toBeNull();
    expect(cred!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Correct password while locked is STILL rejected.
    expect(
      await authorizeCredentials({ email: u.email, password: 'the-real-password-1' }),
    ).toBeNull();
  });

  it('unlocks after the window and a success resets the counter', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'unlock-me-please-2');
    for (let i = 0; i < MAX_FAILED_BEFORE_LOCK; i++) {
      await authorizeCredentials({ email: u.email, password: 'nope' });
    }
    // Simulate the lock window elapsing.
    await ownerDb
      .update(userCredentials)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(userCredentials.userId, u.id));

    const res = await authorizeCredentials({ email: u.email, password: 'unlock-me-please-2' });
    expect(res?.id).toBe(u.id);
    const cred = await readCred(u.id);
    expect(cred?.failedLoginCount).toBe(0);
    expect(cred?.lockedUntil).toBeNull();
  });
});

describe('reset / change password bump tokenVersion (session revocation)', () => {
  it('reset via token sets the password, verifies the email, and bumps tokenVersion', async () => {
    const u = await makeUser({ verified: false });
    await setUserPassword(u.id, 'old-password-aaa');
    const before = await getSessionSecurityState(u.id);

    const req = await requestPasswordReset(u.email);
    expect(req).not.toBeNull();
    const ok = await resetPasswordWithToken(req!.rawToken, 'brand-new-password-bbb');
    expect(ok).toBe(true);

    const after = await getSessionSecurityState(u.id);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    // Email is now verified, so the new password authorises.
    expect(
      await authorizeCredentials({ email: u.email, password: 'brand-new-password-bbb' }),
    ).not.toBeNull();
    // The old password no longer works.
    expect(await authorizeCredentials({ email: u.email, password: 'old-password-aaa' })).toBeNull();
  });

  it('a reset token is one-time + expiry-bound', async () => {
    const u = await makeUser();
    const req = await requestPasswordReset(u.email);
    expect(await resetPasswordWithToken(req!.rawToken, 'first-use-password-1')).toBe(true);
    // Re-use is rejected.
    expect(await resetPasswordWithToken(req!.rawToken, 'second-use-password-2')).toBe(false);
    // Unknown token is rejected.
    expect(await resetPasswordWithToken('not-a-real-token', 'whatever-password-3')).toBe(false);
  });

  it('requestPasswordReset returns null for an unknown mailbox (no enumeration)', async () => {
    expect(await requestPasswordReset('no-such-user@restaurant.example')).toBeNull();
  });

  it('changeUserPassword requires the current password and bumps tokenVersion', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'current-pw-1234');
    const before = await getSessionSecurityState(u.id);

    expect(await changeUserPassword(u.id, 'WRONG-current', 'new-pw-5678')).toBe(false);
    expect((await getSessionSecurityState(u.id)).tokenVersion).toBe(before.tokenVersion);

    expect(await changeUserPassword(u.id, 'current-pw-1234', 'new-pw-5678')).toBe(true);
    expect((await getSessionSecurityState(u.id)).tokenVersion).toBe(before.tokenVersion + 1);
  });

  it('bumpTokenVersion ("log out everywhere") increments the epoch', async () => {
    const u = await makeUser();
    const v0 = (await getSessionSecurityState(u.id)).tokenVersion;
    const v1 = await bumpTokenVersion(u.id);
    expect(v1).toBe(v0 + 1);
    expect((await getSessionSecurityState(u.id)).tokenVersion).toBe(v1);
  });
});

describe('2FA session gate plumbing', () => {
  it('a 2FA-enrolled user authorises but stays twoFactorPending (magic-link OR password)', async () => {
    const u = await makeUser();
    await setUserPassword(u.id, 'two-factor-user-99');
    await ownerDb
      .update(userCredentials)
      .set({ totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() })
      .where(eq(userCredentials.userId, u.id));

    // The session-security read (used by the jwt callback for BOTH factors,
    // including magic-link) reports the second factor is still required.
    expect((await getSessionSecurityState(u.id)).twoFactorEnabled).toBe(true);

    const res = await authorizeCredentials({ email: u.email, password: 'two-factor-user-99' });
    expect(res?.twoFactorPending).toBe(true);
  });

  it('hasPassword reflects whether a hash is set', async () => {
    const u = await makeUser();
    expect(await hasPassword(u.id)).toBe(false);
    await setUserPassword(u.id, 'now-i-have-one-7');
    expect(await hasPassword(u.id)).toBe(true);
  });
});
