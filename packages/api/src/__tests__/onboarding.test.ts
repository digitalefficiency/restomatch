import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, memberships, restaurants, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';

const url = testDbUrl();
const db = createDb(url);

async function resetDb() {
  await db.delete(memberships);
  await db.delete(restaurants);
  await db.delete(users);
}

describe('onboarding router', () => {
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    const [u] = await db
      .insert(users)
      .values({ email: 'test@example.com', name: 'Tester' })
      .returning();
    if (!u) throw new Error('user insert failed');
    userId = u.id;
  });

  afterAll(async () => {
    await resetDb();
  });

  function callerForUser(uid: string) {
    const ctx: AppContext = {
      db,
      session: { userId: uid, restaurantId: null, role: null },
    };
    return appRouter.createCaller(ctx);
  }

  it('returns empty memberships for a new user', async () => {
    const caller = callerForUser(userId);
    const list = await caller.onboarding.myMemberships();
    expect(list).toEqual([]);
  });

  it('createRestaurant creates restaurant and owner membership', async () => {
    const caller = callerForUser(userId);
    const restaurant = await caller.onboarding.createRestaurant({
      name: 'Test Bistro',
      businessId: '123456789',
    });
    expect(restaurant.name).toBe('Test Bistro');
    expect(restaurant.businessId).toBe('123456789');

    const list = await caller.onboarding.myMemberships();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      restaurantId: restaurant.id,
      restaurantName: 'Test Bistro',
      role: 'owner',
    });
  });

  it('createRestaurant accepts optional businessId', async () => {
    const caller = callerForUser(userId);
    const restaurant = await caller.onboarding.createRestaurant({ name: 'No ID Cafe' });
    expect(restaurant.businessId).toBeNull();
  });

  it('createRestaurant rejects empty name', async () => {
    const caller = callerForUser(userId);
    await expect(
      caller.onboarding.createRestaurant({ name: '' }),
    ).rejects.toThrow();
  });

  it('createRestaurant rejects malformed businessId', async () => {
    const caller = callerForUser(userId);
    await expect(
      caller.onboarding.createRestaurant({ name: 'OK', businessId: 'abc' }),
    ).rejects.toThrow();
  });

  it('createRestaurant rejects requests without auth', async () => {
    const ctx: AppContext = { db, session: null };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.onboarding.createRestaurant({ name: 'NoAuth' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('createRestaurant returns UNAUTHORIZED for a ghost userId and orphans nothing', async () => {
    // Simulates a stale JWT cookie whose userId was deleted from the DB
    // (e.g. after a reseed). Must fail cleanly, not leak a raw FK error,
    // and must not leave a restaurant behind.
    const ghostId = '00000000-0000-0000-0000-000000000000';
    const caller = callerForUser(ghostId);
    await expect(
      caller.onboarding.createRestaurant({ name: 'Ghost Bistro' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const remaining = await db.select().from(restaurants);
    expect(remaining).toHaveLength(0);
  });
});
