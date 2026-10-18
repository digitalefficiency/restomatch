import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, userCredentials, users } from '@restomatch/db';
import { twoFactorEnabledForEmail } from '../passwords';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
const db = createDb(url);
const ON = 'tfa-on@twofactor-email.test';
const OFF = 'tfa-off@twofactor-email.test';

beforeAll(async () => {
  const [on] = await db.insert(users).values({ email: ON, emailVerified: new Date() }).returning();
  await db.insert(users).values({ email: OFF, emailVerified: new Date() });
  await db.insert(userCredentials).values({ userId: on!.id, totpEnabledAt: new Date(), totpSecretEnc: 'x' });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.email, ON));
  await db.delete(users).where(eq(users.email, OFF));
});

/** Drives the /login password action's choice between /login/2fa and the callback. */
describe('twoFactorEnabledForEmail', () => {
  it('true only for an enrolled account (case-insensitive email)', async () => {
    expect(await twoFactorEnabledForEmail(ON.toUpperCase())).toBe(true);
    expect(await twoFactorEnabledForEmail(OFF)).toBe(false);
    expect(await twoFactorEnabledForEmail('nobody@twofactor-email.test')).toBe(false);
    expect(await twoFactorEnabledForEmail('')).toBe(false);
  });
});
