import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { captureException } from '@restomatch/observability';
import { sql, withRestaurant, withUser, type Database, type UserRole } from '@restomatch/db';
import type { AppContext, MemberSession } from './context';

const t = initTRPC.context<AppContext>().create({ transformer: superjson });

/** Report procedure errors to observability (no-op until a client is registered). */
const errorCapture = t.middleware(async ({ next, path, type }) => {
  const result = await next();
  if (!result.ok) {
    captureException(result.error, { trpcPath: path, trpcType: type });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorCapture);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/**
 * Authed-but-not-member procedures (onboarding, before a restaurant is
 * selected) run inside a transaction with only `app.current_user_id` set, so
 * the user-scoped RLS policies (memberships_self, users_self,
 * restaurants_member_select) apply on an RLS-enforced connection.
 */
export const userScopedProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const userId = ctx.session.userId;
  const runNext = (tx: Database) => next({ ctx: { ...ctx, db: tx } });
  try {
    return await withUser(ctx.db, userId, async (tx) => {
      const result = await runNext(tx);
      if (!result.ok) throw new TxRollback(result);
      return result;
    });
  } catch (err) {
    if (err instanceof TxRollback) {
      return err.result as Awaited<ReturnType<typeof runNext>>;
    }
    throw err;
  }
});

/**
 * Carries an errored middleware result out of the tenant transaction: tRPC's
 * next() resolves (never throws) even when the procedure errored, but the
 * transaction must still roll back the procedure's writes.
 */
class TxRollback extends Error {
  constructor(readonly result: unknown) {
    super('member procedure errored — rolling back tenant transaction');
  }
}

const memberProcedureBase = authedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session.restaurantId || !ctx.session.role) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User has no active restaurant membership',
    });
  }
  const session: MemberSession = {
    userId: ctx.session.userId,
    restaurantId: ctx.session.restaurantId,
    role: ctx.session.role,
  };
  // Every member procedure runs inside a transaction with the tenant GUCs set
  // (app.current_restaurant_id / app.current_user_id), so the RLS policies in
  // packages/db/drizzle/rls/ scope every statement underneath the app-layer
  // restaurantId filters. Errored procedures roll their writes back.
  const runNext = (tx: Database) => next({ ctx: { ...ctx, db: tx, session } });
  try {
    return await withRestaurant(ctx.db, session.restaurantId, async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_user_id', ${session.userId}, true)`,
      );
      const result = await runNext(tx);
      if (!result.ok) throw new TxRollback(result);
      return result;
    });
  } catch (err) {
    if (err instanceof TxRollback) {
      return err.result as Awaited<ReturnType<typeof runNext>>;
    }
    throw err;
  }
});

export const memberProcedure = memberProcedureBase;

function requireRoles(allowed: ReadonlyArray<UserRole>) {
  return memberProcedureBase.use(({ ctx, next }) => {
    if (!allowed.includes(ctx.session.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Required role: ${allowed.join('|')}, got: ${ctx.session.role}`,
      });
    }
    return next();
  });
}

export const ownerProcedure = requireRoles(['owner']);
export const managerProcedure = requireRoles(['owner', 'manager']);
export const receiverProcedure = requireRoles(['owner', 'manager', 'receiver']);
export const bookkeeperProcedure = requireRoles(['owner', 'bookkeeper']);
export const chefProcedure = requireRoles(['owner', 'manager', 'chef']);
