import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';

function makeCtx(session: Session | null): AppContext {
  return {
    db: {} as never,
    session,
  };
}

describe('RBAC procedures', () => {
  describe('authedProcedure', () => {
    it('rejects requests without a session', async () => {
      const caller = appRouter.createCaller(makeCtx(null));
      await expect(caller.onboarding.myMemberships()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('memberProcedure', () => {
    it('rejects when session has no restaurantId', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: null, role: null }),
      );
      await expect(caller.owner.kpis()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('ownerProcedure', () => {
    it('allows owner role', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: 'r1', role: 'owner' }),
      );
      await expect(caller.owner.leaks()).resolves.toEqual([]);
    });

    it('rejects manager role', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: 'r1', role: 'manager' }),
      );
      await expect(caller.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects receiver role', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: 'r1', role: 'receiver' }),
      );
      await expect(caller.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects bookkeeper role', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: 'r1', role: 'bookkeeper' }),
      );
      await expect(caller.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects chef role', async () => {
      const caller = appRouter.createCaller(
        makeCtx({ userId: 'u1', restaurantId: 'r1', role: 'chef' }),
      );
      await expect(caller.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('kpis (memberProcedure)', () => {
    it('allows any member role', async () => {
      const roles = ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'] as const;
      for (const role of roles) {
        const caller = appRouter.createCaller(
          makeCtx({ userId: 'u1', restaurantId: 'r1', role }),
        );
        await expect(caller.owner.kpis()).resolves.toBeDefined();
      }
    });
  });

  it('returns TRPCError instances', async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    try {
      await caller.owner.leaks();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
    }
  });
});
