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
import { appError, publicErrorMessage, resolveAppError } from './errors';
import { hasCap, type Cap } from './lib/capabilities';

/** The role tier a procedure was built on (G-07). Set by the tier exports below. */
export const TIERS = [
  'public',
  'authed',
  'userScoped',
  'member',
  'owner',
  'manager',
  'receiver',
  'bookkeeper',
  'chef',
  'invoiceReader',
  'finance',
  'admin',
] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Procedure metadata (G-07). Optional fields so a bare `t.procedure` still
 * typechecks; tRPC merges meta shallowly across `.use()` / `.meta()`, so a
 * tier's `tier` flows into router-local wrappers and `can()` adds `cap`.
 */
export interface ProcMeta {
  tier?: Tier;
  cap?: Cap;
}

const t = initTRPC.context<AppContext>().meta<ProcMeta>().create({
  transformer: superjson,
  // Expose a stable machine code (`data.appCode`, see errors.ts) so clients
  // translate errors by code, never by matching the (Hebrew) message text.
  errorFormatter({ shape, error }) {
    const resolved = resolveAppError(error);
    const isProduction = process.env.NODE_ENV === 'production';
    // Defence in depth: never ship a stack trace in production, whatever isDev
    // tRPC computed at init.
    const { stack: _stack, ...data } = shape.data;
    return {
      ...shape,
      // Production never echoes an unexpected error's raw text (Postgres errors
      // carry constraint/column names and SQL fragments) — see errors.ts.
      message: publicErrorMessage(error, resolved, isProduction),
      data: {
        ...(isProduction ? data : shape.data),
        appCode: resolved?.appCode ?? null,
        appParams: resolved?.appParams ?? null,
      },
    };
  },
});

/** Report procedure errors to observability (no-op until a client is registered). */
const errorCapture = t.middleware(async ({ next, path, type }) => {
  const result = await next();
  if (!result.ok) {
    captureException(result.error, { trpcPath: path, trpcType: type });
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorCapture).meta({ tier: 'public' });

export const authedProcedure = publicProcedure.meta({ tier: 'authed' }).use(({ ctx, next }) => {
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
export const userScopedProcedure = authedProcedure.meta({ tier: 'userScoped' }).use(async ({ ctx, next }) => {
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

const memberProcedureBase = authedProcedure.meta({ tier: 'member' }).use(async ({ ctx, next }) => {
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

function requireRoles(allowed: ReadonlyArray<UserRole>, tier: Tier) {
  return memberProcedureBase.meta({ tier }).use(({ ctx, next }) => {
    if (!allowed.includes(ctx.session.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Required role: ${allowed.join('|')}, got: ${ctx.session.role}`,
      });
    }
    return next();
  });
}

export const ownerProcedure = requireRoles(['owner'], 'owner');
export const managerProcedure = requireRoles(['owner', 'manager'], 'manager');
export const receiverProcedure = requireRoles(['owner', 'manager', 'receiver'], 'receiver');
export const bookkeeperProcedure = requireRoles(['owner', 'bookkeeper'], 'bookkeeper');
export const chefProcedure = requireRoles(['owner', 'manager', 'chef'], 'chef');
/**
 * Roles that may read a supplier invoice's lines over tRPC (no chef). Wider than
 * the /dashboard/invoices page gate: the receiver keeps it for the Delivery Check
 * wizard's OCR polling (receiving.getInvoice) but opens no invoice page (no ₪).
 * Stripping ₪ fields for the receiver is H-11.
 */
export const INVOICE_READER_ROLES: ReadonlyArray<UserRole> = ['owner', 'manager', 'receiver', 'bookkeeper'];
/** One supplier invoice (lines, prices, image) — see INVOICE_READER_ROLES. */
export const invoiceReaderProcedure = requireRoles(INVOICE_READER_ROLES, 'invoiceReader');
/** Invoice-level money detail (leak drill-down, claims) — matches /dashboard/leaks. */
export const financeProcedure = requireRoles(['owner', 'manager', 'bookkeeper'], 'finance');

/**
 * Platform-admin procedure for the internal ops console. Cross-tenant BY
 * DESIGN — it does NOT establish a restaurant GUC and runs on the owner/service
 * connection (ctx.adminDb), so it bypasses per-tenant RLS to manage every
 * tenant. Authorized by the users.is_platform_admin flag OR the
 * PLATFORM_ADMIN_EMAILS env allowlist (bootstrap for the first admin).
 */
export const adminProcedure = authedProcedure.meta({ tier: 'admin' }).use(async ({ ctx, next }) => {
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

/**
 * Capability gate as a composable middleware (no meta): `anyTier.use(requireCap('order.send'))`.
 * Prefer `can()`, which also records `meta.cap` for the procedure walk.
 * FORBIDDEN with appCode `capability.required` + `appParams.capability`.
 */
export function requireCap(cap: Cap) {
  return t.middleware(({ ctx, next }) => {
    const session = ctx.session as MemberSession | null;
    if (!session?.role || !hasCap(session.role, cap)) {
      throw appError('FORBIDDEN', 'capability.required', `Required capability: ${cap}`, {
        capability: cap,
      });
    }
    return next();
  });
}

/**
 * G-07 capability builder: a member procedure (or `base`, any member-or-higher
 * tier) that records `meta.cap` and rejects callers whose role lacks `cap`.
 *
 *   createDraft: can('order.draft').input(...).mutation(...)
 *   send:        can('order.send', chefProcedure).input(...).mutation(...)
 *
 * Row-level rules (own rows, price redaction) stay in the resolver: `canOn`,
 * `redactPrices` (lib/capabilities.ts).
 */
export function can(cap: Cap, base = memberProcedureBase) {
  return base.meta({ cap }).use(requireCap(cap));
}
