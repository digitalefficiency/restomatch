import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, eq, inArray, memberships, restaurants, testDbUrl, users } from '@restomatch/db';
import { isUndeliverableAddress, recipientsForRestaurant } from '../notifications/recipients';

/**
 * 7.11: the demo tenant's members are @kfar-hazeitim.test. In production its
 * recovery reminder was queued, rejected by the provider, retried five times
 * and parked as failed. Production now skips reserved-TLD addresses (logging
 * the domain only); dev and test keep them — their fixtures use them on purpose.
 */
const db = createDb(testDbUrl());
const RUN = `${process.pid}-${Date.now()}`;
const PROD = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const TEST = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;

let restaurantId = '';
const userIds: string[] = [];
const REAL = `owner-${RUN}@restomatch-real.co.il`;
const DEMO = `manager-${RUN}@kfar-hazeitim.test`;
const LOCAL = `chef-${RUN}@dev.local`;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: `recipients ${RUN}` }).returning();
  restaurantId = r!.id;
  for (const [email, role] of [
    [REAL, 'owner'],
    [DEMO, 'manager'],
    [LOCAL, 'manager'],
  ] as const) {
    const [u] = await db.insert(users).values({ email }).returning();
    userIds.push(u!.id);
    await db.insert(memberships).values({ userId: u!.id, restaurantId, role });
  }
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.delete(memberships).where(eq(memberships.restaurantId, restaurantId));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('isUndeliverableAddress', () => {
  it('flags the reserved TLDs, case-insensitive, and nothing else', () => {
    for (const e of ['a@x.test', 'a@x.local', 'a@x.example', 'a@x.invalid', 'a@localhost', 'a@X.TEST', 'a@x.test.']) {
      expect(isUndeliverableAddress(e), e).toBe(true);
    }
    for (const e of ['a@restomatch.co.il', 'a@gmail.com', 'a@test.co.il', 'a@local.example.co.il', 'a@x.testing']) {
      expect(isUndeliverableAddress(e), e).toBe(false);
    }
  });
});

describe('recipientsForRestaurant — reserved TLDs', () => {
  it('production: skips them, keeps the real address, logs the domain only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const got = await recipientsForRestaurant(db, restaurantId, undefined, { env: PROD });
    expect(got.map((r) => r.email)).toEqual([REAL]);
    const lines = info.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes('@kfar-hazeitim.test'))).toBe(true);
    expect(lines.some((l) => l.includes('@dev.local'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain(DEMO);
      expect(l).not.toContain(LOCAL);
    }
  });

  it('dev / test: unchanged — every member address is returned', async () => {
    const got = await recipientsForRestaurant(db, restaurantId, undefined, { env: TEST });
    expect(got.map((r) => r.email).sort()).toEqual([REAL, DEMO, LOCAL].sort());
  });
});
