import { testDbUrl } from '@restomatch/db';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, memberships, restaurants, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

/**
 * RBAC tests focus on the middleware tiers — they need real DB access for
 * the queries the procedures run after middleware passes. We seed once and
 * reuse for read-only assertions.
 */

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

let restaurantId: string;

beforeAll(async () => {
  await db.delete(memberships);
  await db.delete(restaurants);
  await db.delete(users);
  const [r] = await db.insert(restaurants).values({ name: 'RBAC Bistro' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(memberships);
  await db.delete(restaurants);
  await db.delete(users);
});

function makeCtx(session: Session | null): AppContext {
  return { db, session };
}

describe('RBAC — authedProcedure', () => {
  it('rejects requests without a session', async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.onboarding.myMemberships()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('RBAC — memberProcedure', () => {
  it('rejects when session has no restaurantId', async () => {
    const caller = appRouter.createCaller(
      makeCtx({ userId: 'u1', restaurantId: null, role: null }),
    );
    await expect(caller.owner.kpis()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('RBAC — ownerProcedure', () => {
  it('allows owner role', async () => {
    const caller = appRouter.createCaller(makeCtx({ userId: 'u1', restaurantId, role: 'owner' }));
    await expect(caller.owner.leaks()).resolves.toEqual([]);
  });

  it.each([['manager'], ['receiver'], ['bookkeeper'], ['chef']] as const)(
    'rejects %s role',
    async (role) => {
      const caller = appRouter.createCaller(makeCtx({ userId: 'u1', restaurantId, role }));
      await expect(caller.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );
});

describe('RBAC — kpis (memberProcedure)', () => {
  it.each([['owner'], ['manager'], ['receiver'], ['bookkeeper'], ['chef']] as const)(
    'allows %s role',
    async (role) => {
      const caller = appRouter.createCaller(makeCtx({ userId: 'u1', restaurantId, role }));
      await expect(caller.owner.kpis()).resolves.toBeDefined();
    },
  );
});

describe('RBAC — TRPCError instances', () => {
  it('returns TRPCError on unauthenticated access', async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    try {
      await caller.owner.leaks();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
    }
  });
});
