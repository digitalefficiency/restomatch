import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq, memberships, restaurants, sql, storageNamespaces, users, type Database } from '@restomatch/db';
import { z } from 'zod';
import { appError } from '../errors';
import { router, userScopedProcedure } from '../trpc';
import { hasNoControlChars, NO_CONTROL_CHARS_MESSAGE } from '../lib/text';

/** The caller fields the sign-up gate reads (their own users row). */
interface SignupCaller {
  email: string;
  emailVerified: Date | null;
  isPlatformAdmin: boolean;
}

function emailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * May this caller create a tenant? Each new tenant gets an implicit trial with
 * real, unmetered OCR, so open self-sign-up is closed in production (pilot: by
 * invitation only). Allowed when any of:
 *  - SIGNUP_OPEN === '1' (an explicit '0' closes it everywhere);
 *  - the caller's VERIFIED email is in SIGNUP_ALLOWLIST (comma list, any case);
 *  - the caller is a platform admin (users.is_platform_admin, or a verified
 *    PLATFORM_ADMIN_EMAILS address — the same rule as adminProcedure).
 * With SIGNUP_OPEN unset: open only when NODE_ENV is exactly 'development' or
 * 'test' (fail closed: production, staging, a missing NODE_ENV — all closed).
 */
export function signupAllowed(user: SignupCaller, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SIGNUP_OPEN === '1') return true;
  const openByDefault =
    env.SIGNUP_OPEN === undefined && (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');
  if (openByDefault) return true;
  if (user.isPlatformAdmin) return true;
  if (user.emailVerified == null) return false;
  const email = user.email.toLowerCase();
  return emailList(env.SIGNUP_ALLOWLIST).includes(email) || emailList(env.PLATFORM_ADMIN_EMAILS).includes(email);
}

async function signupCaller(db: Database, userId: string): Promise<SignupCaller | null> {
  const [user] = await db
    .select({ email: users.email, emailVerified: users.emailVerified, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}

export const onboardingRouter = router({
  myMemberships: userScopedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        restaurantId: memberships.restaurantId,
        restaurantName: restaurants.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
      .where(eq(memberships.userId, ctx.session.userId));
    return rows;
  }),

  /** Whether the caller may create a restaurant (the onboarding page shows the invitation-only note otherwise). */
  signupStatus: userScopedProcedure.query(async ({ ctx }) => {
    const user = await signupCaller(ctx.db, ctx.session.userId);
    return { open: user != null && signupAllowed(user) };
  }),

  createRestaurant: userScopedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120).refine(hasNoControlChars, NO_CONTROL_CHARS_MESSAGE),
        businessId: z
          .string()
          .min(9)
          .max(12)
          .regex(/^\d+$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // The session is a stateless JWT stored in the browser cookie. If the
      // DB was reseeded/reset the user row can be gone while the cookie still
      // carries a ghost userId. Verify the user exists first, otherwise the
      // membership insert dies on a raw FK violation and orphans a restaurant.
      const user = await signupCaller(ctx.db, ctx.session.userId);
      if (!user) {
        throw appError(
          'UNAUTHORIZED',
          'onboarding.accountGone',
          'החשבון שלך כבר לא קיים. התנתק והתחבר מחדש כדי להמשיך.',
        );
      }
      if (!signupAllowed(user)) {
        throw appError('FORBIDDEN', 'signup_closed', 'ההרשמה כרגע בהזמנה בלבד.');
      }

      return ctx.db.transaction(async (tx) => {
        // Generate the tenant id up front and set the RLS GUC to it, so the
        // insert satisfies restaurants_tenant and RETURNING can see the row.
        // Without a GUC the policies allow no inserts at all.
        const restaurantId = randomUUID();
        await tx.execute(
          sql`select set_config('app.current_restaurant_id', ${restaurantId}, true)`,
        );
        const [restaurant] = await tx
          .insert(restaurants)
          .values({
            id: restaurantId,
            name: input.name,
            businessId: input.businessId,
          })
          .returning();
        if (!restaurant) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'failed to create restaurant',
          });
        }

        await tx.insert(memberships).values({
          userId: ctx.session.userId,
          restaurantId: restaurant.id,
          role: 'owner',
        });

        // A.4 — auto-provision an isolated, quota-trackable storage namespace
        // for this tenant in the SAME transaction. The prefix '<restaurantId>/'
        // is what the prefix-scoped storage.objects RLS
        // (drizzle/rls/0001_invoice_scans_rls.sql) and the server-side scans
        // upload (scans.upload) key on.
        await tx.insert(storageNamespaces).values({
          restaurantId: restaurant.id,
          bucket: 'invoice-scans',
          prefix: `${restaurant.id}/`,
        });

        return restaurant;
      });
    }),
});
