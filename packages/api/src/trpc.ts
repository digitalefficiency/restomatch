import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { captureException } from '@restomatch/observability';
import {
  eq,
  sql,
  users,
  withRestaurant,
  withUser,
  type Database,
  type FeatureKey,
  type UserRole,
} from '@restomatch/db';
import type { AppContext, MemberSession } from './context';
import { getEntitlements } from './entitlements';

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
  // A 2FA-pending session has only passed the FIRST factor — treat it as
  // unauthenticated everywhere (Epic C). The /login/2fa second step runs as a
  // server action, not a tRPC procedure, so no carve-out is needed here.
  if (!ctx.session || ctx.session.twoFactorPending) {
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

/**
 * Platform-admin procedure for the internal ops console. Cross-tenant BY
 * DESIGN — it does NOT establish a restaurant GUC and runs on the owner/service
 * connection (ctx.adminDb), so it bypasses per-tenant RLS to manage every
 * tenant. Authorized by the users.is_platform_admin flag OR the
 * PLATFORM_ADMIN_EMAILS env allowlist (bootstrap for the first admin).
 */
export const adminProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const conn = ctx.adminDb ?? ctx.db;
  const [user] = await conn
    .select({
      email: users.email,
      emailVerified: users.emailVerified,
      isAdmin: users.isPlatformAdmin,
    })
    .from(users)
    .where(eq(users.id, ctx.session.userId))
    .limit(1);
  const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // The allowlist trusts an email address, so require it to be verified — a
  // second auth provider could otherwise mint a session for an allowlisted
  // email without proving mailbox control.
  const allowlisted =
    !!user && user.emailVerified != null && allowlist.includes(user.email.toLowerCase());
  const isAdmin = !!user && (user.isAdmin || allowlisted);
  if (!isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'platform admin only' });
  }
  // Admin resolvers query cross-tenant on the owner connection.
  return next({ ctx: { ...ctx, db: conn } });
});

/**
 * Plan-feature gate, composed onto a role procedure with `.use()`:
 *   bookkeeperProcedure.use(requireFeature('accounting_export'))
 *
 * Runs inside the member transaction (GUC set), so getEntitlements reads under
 * RLS. Throws FORBIDDEN with code ENTITLEMENT_REQUIRED so the web can show an
 * upgrade CTA. This is the single revenue-enforcement point — keep gates here,
 * not scattered in resolvers.
 */
export function requireFeature(feature: FeatureKey) {
  return t.middleware(async ({ ctx, next }) => {
    const session = ctx.session as MemberSession | null;
    if (!session?.restaurantId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'no active restaurant' });
    }
    const ent = await getEntitlements(ctx.db, session.restaurantId);
    if (!ent.active || !ent.features.includes(feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `ENTITLEMENT_REQUIRED:${feature}`,
        cause: { code: 'ENTITLEMENT_REQUIRED', feature, planKey: ent.planKey },
      });
    }
    return next();
  });
}
