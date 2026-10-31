import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, memberships, restaurants, testDbUrl, users } from '@restomatch/db';
import { appRouter } from '../index';
import { signupAllowed } from '../routers/onboarding';
import type { AppContext } from '../context';

/**
 * Closed sign-up (pilot): in production a stranger's magic link must not turn
 * into a tenant (each one gets an implicit trial with real, unmetered OCR).
 * onboarding.createRestaurant is open only with SIGNUP_OPEN=1, a verified
 * SIGNUP_ALLOWLIST email, or a platform admin.
 */
const db = createDb(testDbUrl());
const ENV_KEYS = ['NODE_ENV', 'SIGNUP_OPEN', 'SIGNUP_ALLOWLIST', 'PLATFORM_ADMIN_EMAILS'] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function resetDb() {
  await db.delete(memberships);
  await db.delete(restaurants);
  await db.delete(users);
}

async function newUser(email: string, opts: { verified?: boolean; admin?: boolean } = {}) {
  const [u] = await db
    .insert(users)
    .values({
      email,
      name: 'Signer',
      emailVerified: opts.verified === false ? null : new Date(),
      isPlatformAdmin: opts.admin ?? false,
    })
    .returning();
  return u!.id;
}

function callerFor(userId: string) {
  const ctx: AppContext = { db, session: { userId, restaurantId: null, role: null } };
  return appRouter.createCaller(ctx);
}

async function tenantsOf(userId: string) {
  return db.select().from(memberships).where(eq(memberships.userId, userId));
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  await resetDb();
});

afterEach(() => {
  setEnv(saved);
});

afterAll(async () => {
  await resetDb();
});

describe('attack: a stranger cannot create a restaurant while sign-up is closed', () => {
  it('production, nothing configured: FORBIDDEN signup_closed, no restaurant, no membership', async () => {
    setEnv({ NODE_ENV: 'production', SIGNUP_OPEN: undefined, SIGNUP_ALLOWLIST: undefined, PLATFORM_ADMIN_EMAILS: undefined });
    const stranger = await newUser('stranger@example.com');
    const before = (await db.select({ id: restaurants.id }).from(restaurants)).length;

    const err = await callerFor(stranger)
      .onboarding.createRestaurant({ name: 'Hijack Bistro' })
      .then(
        () => null,
        (e: unknown) => e as { code?: string; cause?: { appCode?: string } },
      );
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(err!.cause?.appCode).toBe('signup_closed');
    expect((await db.select({ id: restaurants.id }).from(restaurants)).length).toBe(before);
    expect(await tenantsOf(stranger)).toEqual([]);
    expect(await callerFor(stranger).onboarding.signupStatus()).toEqual({ open: false });
  });

  it('a non-allowlisted user is refused even when an allowlist exists', async () => {
    setEnv({ NODE_ENV: 'production', SIGNUP_ALLOWLIST: 'owner@tziki.example' });
    const stranger = await newUser('someone-else@example.com');
    await expect(callerFor(stranger).onboarding.createRestaurant({ name: 'Nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await tenantsOf(stranger)).toEqual([]);
  });

  it('an allowlisted address that is NOT verified is refused (the allowlist trusts mailbox control)', async () => {
    setEnv({ NODE_ENV: 'production', SIGNUP_ALLOWLIST: 'owner@tziki.example' });
    const unverified = await newUser('owner@tziki.example', { verified: false });
    await expect(callerFor(unverified).onboarding.createRestaurant({ name: 'Nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await tenantsOf(unverified)).toEqual([]);
  });

  it('SIGNUP_OPEN=0 closes it outside production too', async () => {
    setEnv({ NODE_ENV: 'development', SIGNUP_OPEN: '0' });
    const u = await newUser('dev@example.com');
    await expect(callerFor(u).onboarding.createRestaurant({ name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('who may still sign up in production', () => {
  it('a verified allowlisted email (case-insensitive, spaces trimmed)', async () => {
    setEnv({ NODE_ENV: 'production', SIGNUP_ALLOWLIST: ' other@x.example , Owner@Tziki.Example ' });
    const owner = await newUser('owner@tziki.example');
    expect(await callerFor(owner).onboarding.signupStatus()).toEqual({ open: true });
    const r = await callerFor(owner).onboarding.createRestaurant({ name: 'ציקטי' });
    expect(r.name).toBe('ציקטי');
    expect(await tenantsOf(owner)).toHaveLength(1);
  });

  it('a platform admin (flag, or verified PLATFORM_ADMIN_EMAILS)', async () => {
    setEnv({ NODE_ENV: 'production', PLATFORM_ADMIN_EMAILS: 'ops@restomatch.co' });
    const flagged = await newUser('flagged@restomatch.co', { admin: true });
    const listed = await newUser('ops@restomatch.co');
    await expect(callerFor(flagged).onboarding.createRestaurant({ name: 'Ops A' })).resolves.toBeDefined();
    await expect(callerFor(listed).onboarding.createRestaurant({ name: 'Ops B' })).resolves.toBeDefined();
  });

  it('anyone when SIGNUP_OPEN=1', async () => {
    setEnv({ NODE_ENV: 'production', SIGNUP_OPEN: '1' });
    const u = await newUser('walk-in@example.com');
    await expect(callerFor(u).onboarding.createRestaurant({ name: 'Open Day' })).resolves.toBeDefined();
  });
});

describe('signupAllowed defaults', () => {
  const user = { email: 'a@b.example', emailVerified: new Date(), isPlatformAdmin: false };
  it('open in dev and test with nothing set, closed in production', () => {
    expect(signupAllowed(user, { NODE_ENV: 'development' })).toBe(true);
    expect(signupAllowed(user, { NODE_ENV: 'test' })).toBe(true);
    expect(signupAllowed(user, { NODE_ENV: 'production' })).toBe(false);
  });
  it('only "1" opens it; any other SIGNUP_OPEN value in production stays closed', () => {
    expect(signupAllowed(user, { NODE_ENV: 'production', SIGNUP_OPEN: '1' })).toBe(true);
    expect(signupAllowed(user, { NODE_ENV: 'production', SIGNUP_OPEN: 'true' })).toBe(false);
    expect(signupAllowed(user, { NODE_ENV: 'production', SIGNUP_OPEN: '' })).toBe(false);
  });
});
