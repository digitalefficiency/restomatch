import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  billingAccounts,
  count,
  desc,
  eq,
  leads,
  memberships,
  plans,
  restaurants,
  sql,
  userCredentials,
  subscriptions,
  usageCounters,
  users,
  type PlanLimits,
} from '@restomatch/db';
import { adminProcedure, authedProcedure, router } from '../trpc';
import { recordAudit } from '../audit';
import { appError } from '../errors';
import { usagePeriod } from '../entitlements';
import { FEATURE_KEYS, featureEnabled, type FeatureKey } from '../lib/features';

const PlanKeyEnum = z.enum(['trial', 'basic', 'pro', 'chain']);
const StatusEnum = z.enum(['trialing', 'active', 'past_due', 'canceled']);

const OverridesSchema = z.object({
  // Numeric overrides are >= 1; null keeps the plan default. (0 is rejected — it
  // would silently hard-block the tenant via the quota check, surfacing a
  // misleading "quota exceeded" instead of a clear signal.)
  limits: z
    .object({
      invoicesPerMonth: z.number().int().min(1).max(1_000_000).nullable().optional(),
      restaurants: z.number().int().min(1).max(10_000).nullable().optional(),
      seatsPerRestaurant: z.number().int().min(1).max(10_000).nullable().optional(),
    })
    .partial()
    .optional(),
  features: z
    .array(z.enum(['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export']))
    .max(8)
    .optional(),
});

/**
 * A per-restaurant feature-flag patch (restaurants.settings.features). Keys are
 * the wave-1 FEATURE_KEYS only: 'all' (the demo tenant's switch) is not
 * settable here — an unknown key is rejected, never stored.
 */
const FeaturePatchSchema = z
  .record(z.enum(FEATURE_KEYS), z.boolean())
  .refine((p) => Object.keys(p).length > 0, { message: 'no features to change' });

type StoredFeatures = Partial<Record<FeatureKey | 'all', boolean>>;

function storedFeatures(settings: unknown): StoredFeatures {
  const f = (settings as { features?: unknown } | null | undefined)?.features;
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as StoredFeatures) : {};
}

/** What the console shows for one tenant's flags: what is stored, and what is in effect. */
function featureState(settings: unknown) {
  const stored = storedFeatures(settings);
  return {
    stored,
    all: stored.all === true,
    effective: Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureEnabled(settings, k)])) as Record<
      FeatureKey,
      boolean
    >,
    /** Turned off for every tenant by the FEATURES_OFF kill-switch. */
    killed: FEATURE_KEYS.filter((k) => featureEnabled({ features: { [k]: true } }, k) === false),
  };
}

/**
 * Internal ops console. Every procedure is adminProcedure — cross-tenant on the
 * owner connection, gated by users.is_platform_admin / PLATFORM_ADMIN_EMAILS
 * and an enrolled authenticator. Mutations are audit-logged, and so are reads
 * of tenant data ('admin.viewed', one row per tenant viewed).
 */
export const adminRouter = router({
  /**
   * Whether the caller's own login has an authenticator (TOTP) enrolled — the
   * console's precondition (adminProcedure refuses with admin_requires_2fa
   * without it). /admin asks first so it can show the enrol prompt without a
   * refused call. Reveals only the caller's own enrolment, nothing cross-tenant.
   */
  twoFactorStatus: authedProcedure.query(async ({ ctx }) => {
    const conn = ctx.adminDb ?? ctx.db;
    const [cred] = await conn
      .select({ totpEnabledAt: userCredentials.totpEnabledAt })
      .from(userCredentials)
      .where(eq(userCredentials.userId, ctx.session.userId))
      .limit(1);
    return { enabled: cred?.totpEnabledAt != null };
  }),

  /** All restaurants with their resolved plan, status, usage, member count. */
  listRestaurants: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        createdAt: restaurants.createdAt,
        billingAccountId: restaurants.billingAccountId,
        planKey: plans.key,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
      })
      .from(restaurants)
      .leftJoin(
        subscriptions,
        eq(subscriptions.billingAccountId, restaurants.billingAccountId),
      )
      .leftJoin(plans, eq(plans.id, subscriptions.planId))
      .orderBy(desc(restaurants.createdAt));

    const memberCounts = await ctx.db
      .select({ restaurantId: memberships.restaurantId, c: count(memberships.userId) })
      .from(memberships)
      .groupBy(memberships.restaurantId);
    const memberMap = new Map(memberCounts.map((m) => [m.restaurantId, Number(m.c)]));

    const period = usagePeriod();
    const usageRows = await ctx.db
      .select({ billingAccountId: usageCounters.billingAccountId, used: usageCounters.used })
      .from(usageCounters)
      .where(and(eq(usageCounters.period, period), eq(usageCounters.metric, 'ocr_scans')));
    const usageMap = new Map(usageRows.map((u) => [u.billingAccountId, u.used]));

    // Each tenant's plan, usage and member count was shown: one access row per
    // tenant, all or none (a failed insert returns no data and leaves no rows).
    await ctx.db.transaction(async (tx) => {
      for (const r of rows) {
        await recordAudit(tx, {
          restaurantId: r.id,
          userId: ctx.session.userId,
          action: 'admin.viewed',
          entityType: 'restaurant',
          entityId: r.id,
          after: { view: 'list' },
        });
      }
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      planKey: r.planKey ?? 'trial', // no subscription ⇒ implicit trial
      implicit: r.planKey === null,
      status: r.status ?? 'trialing',
      trialEndsAt: r.trialEndsAt,
      members: memberMap.get(r.id) ?? 0,
      ocrScansThisMonth: r.billingAccountId ? usageMap.get(r.billingAccountId) ?? 0 : 0,
    }));
  }),

  /** Detail for one restaurant: subscription, overrides, members, usage. */
  getRestaurant: adminProcedure
    .input(z.object({ restaurantId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          businessId: restaurants.businessId,
          createdAt: restaurants.createdAt,
          billingAccountId: restaurants.billingAccountId,
          settings: restaurants.settings,
        })
        .from(restaurants)
        .where(eq(restaurants.id, input.restaurantId))
        .limit(1);
      if (!r) throw appError('NOT_FOUND', 'admin.notFound', 'restaurant not found');
      const { settings, ...restaurant } = r;

      let subscription: {
        planKey: string;
        status: string;
        trialEndsAt: Date | null;
        overrides: unknown;
      } | null = null;
      if (r.billingAccountId) {
        const [s] = await ctx.db
          .select({
            planKey: plans.key,
            status: subscriptions.status,
            trialEndsAt: subscriptions.trialEndsAt,
            overrides: subscriptions.overrides,
          })
          .from(subscriptions)
          .innerJoin(plans, eq(plans.id, subscriptions.planId))
          .where(eq(subscriptions.billingAccountId, r.billingAccountId))
          .limit(1);
        subscription = s ?? null;
      }

      const members = await ctx.db
        .select({
          userId: memberships.userId,
          role: memberships.role,
          email: users.email,
          name: users.name,
          preferredLocale: memberships.preferredLocale,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.restaurantId, input.restaurantId));

      await recordAudit(ctx.db, {
        restaurantId: r.id,
        userId: ctx.session.userId,
        action: 'admin.viewed',
        entityType: 'restaurant',
        entityId: r.id,
        after: { view: 'detail' },
      });

      return { restaurant, subscription, members, features: featureState(settings) };
    }),

  /** Assign / change a plan; creates the billing account + subscription as needed. */
  assignPlan: adminProcedure
    .input(
      z.object({
        restaurantId: z.string().uuid(),
        planKey: PlanKeyEnum,
        status: StatusEnum.optional(),
        trialDays: z.number().int().min(0).max(365).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const status = input.status ?? (input.planKey === 'trial' ? 'trialing' : 'active');
      const trialEndsAt =
        status === 'trialing' && input.trialDays
          ? new Date(Date.now() + input.trialDays * 24 * 60 * 60 * 1000)
          : null;

      // One serialized transaction per restaurant: lock the restaurant row so
      // two concurrent assignPlan calls can't both create a billing account
      // (the read-then-link would otherwise race into duplicate/orphaned
      // accounts). The subscription write is an idempotent upsert.
      return ctx.db.transaction(async (tx) => {
        const [r] = await tx
          .select({
            id: restaurants.id,
            name: restaurants.name,
            billingAccountId: restaurants.billingAccountId,
          })
          .from(restaurants)
          .where(eq(restaurants.id, input.restaurantId))
          .for('update')
          .limit(1);
        if (!r) throw appError('NOT_FOUND', 'admin.notFound', 'restaurant not found');

        const [plan] = await tx
          .select({ id: plans.id })
          .from(plans)
          .where(eq(plans.key, input.planKey))
          .limit(1);
        if (!plan) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `plan ${input.planKey} not found` });
        }

        let billingAccountId = r.billingAccountId;
        if (!billingAccountId) {
          const [owner] = await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(and(eq(memberships.restaurantId, r.id), eq(memberships.role, 'owner')))
            .limit(1);
          const [account] = await tx
            .insert(billingAccounts)
            .values({ name: r.name, ownerUserId: owner?.userId ?? null })
            .returning();
          if (!account) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'account' });
          billingAccountId = account.id;
          await tx.update(restaurants).set({ billingAccountId }).where(eq(restaurants.id, r.id));
        }

        // Capture prior plan/status for the audit before-image.
        const [prior] = await tx
          .select({ planKey: plans.key, status: subscriptions.status })
          .from(subscriptions)
          .innerJoin(plans, eq(plans.id, subscriptions.planId))
          .where(eq(subscriptions.billingAccountId, billingAccountId))
          .limit(1);

        // Race-safe single-statement upsert (one subscription per account).
        await tx
          .insert(subscriptions)
          .values({ billingAccountId, planId: plan.id, status, trialEndsAt })
          .onConflictDoUpdate({
            target: subscriptions.billingAccountId,
            set: { planId: plan.id, status, trialEndsAt, updatedAt: new Date() },
          });

        await recordAudit(tx, {
          restaurantId: r.id,
          userId: ctx.session.userId,
          action: 'admin.plan_assigned',
          entityType: 'restaurant',
          entityId: r.id,
          before: prior ?? null,
          after: { planKey: input.planKey, status, trialEndsAt },
        });

        return { billingAccountId, planKey: input.planKey, status, trialEndsAt };
      });
    }),

  /** Set per-tenant limit / feature overrides on the subscription. */
  setOverrides: adminProcedure
    .input(z.object({ restaurantId: z.string().uuid(), overrides: OverridesSchema }))
    .mutation(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select({ billingAccountId: restaurants.billingAccountId })
        .from(restaurants)
        .where(eq(restaurants.id, input.restaurantId))
        .limit(1);
      if (!r?.billingAccountId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'restaurant has no subscription — assign a plan first',
        });
      }
      const overrides = {
        ...(input.overrides.limits
          ? { limits: input.overrides.limits as Partial<PlanLimits> }
          : {}),
        ...(input.overrides.features ? { features: input.overrides.features } : {}),
      };
      // Capture the prior overrides for the audit before-image (RETURNING would
      // give the post-update value).
      const [prior] = await ctx.db
        .select({ overrides: subscriptions.overrides })
        .from(subscriptions)
        .where(eq(subscriptions.billingAccountId, r.billingAccountId))
        .limit(1);
      if (!prior) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'subscription not found' });
      }
      await ctx.db
        .update(subscriptions)
        .set({ overrides, updatedAt: new Date() })
        .where(eq(subscriptions.billingAccountId, r.billingAccountId));

      await recordAudit(ctx.db, {
        restaurantId: input.restaurantId,
        userId: ctx.session.userId,
        action: 'admin.overrides_set',
        entityType: 'restaurant',
        entityId: input.restaurantId,
        before: prior.overrides,
        after: overrides,
      });
      return { ok: true as const };
    }),

  /**
   * Turn individual wave-1 features on or off for one tenant
   * (restaurants.settings.features). MERGES the patch into the stored flags in
   * one statement (jsonb ||): every other settings key — tolerances, recipes,
   * the demo's 'all' — and every flag not in the patch stay exactly as they were.
   */
  setFeatures: adminProcedure
    .input(z.object({ restaurantId: z.string().uuid(), features: FeaturePatchSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [r] = await tx
          .select({ id: restaurants.id, settings: restaurants.settings })
          .from(restaurants)
          .where(eq(restaurants.id, input.restaurantId))
          .for('update')
          .limit(1);
        if (!r) throw appError('NOT_FOUND', 'admin.notFound', 'restaurant not found');
        const before = storedFeatures(r.settings);

        const [updated] = await tx
          .update(restaurants)
          .set({
            settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), '{features}', (case when jsonb_typeof(${restaurants.settings}->'features') = 'object' then ${restaurants.settings}->'features' else '{}'::jsonb end) || ${JSON.stringify(input.features)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, r.id))
          .returning({ settings: restaurants.settings });
        const after = storedFeatures(updated?.settings);

        await recordAudit(tx, {
          restaurantId: r.id,
          userId: ctx.session.userId,
          action: 'admin.features',
          entityType: 'restaurant',
          entityId: r.id,
          before,
          after,
        });
        return { features: featureState(updated?.settings) };
      });
    }),

  /** Change a member's role within a restaurant. */
  setMemberRole: adminProcedure
    .input(
      z.object({
        restaurantId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['owner', 'manager', 'receiver', 'bookkeeper', 'chef']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [current] = await ctx.db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.restaurantId, input.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        )
        .limit(1);
      if (!current) throw appError('NOT_FOUND', 'admin.notFound', 'membership not found');

      // Never strand a restaurant with zero owners — owner-gated tenant
      // operations would become permanently inaccessible with no self-service
      // recovery.
      if (current.role === 'owner' && input.role !== 'owner') {
        const owners = await ctx.db
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(eq(memberships.restaurantId, input.restaurantId), eq(memberships.role, 'owner')),
          );
        const remaining = owners.filter((o) => o.userId !== input.userId).length;
        if (remaining === 0) {
          throw appError(
            'CONFLICT',
            'admin.lastOwner',
            'cannot demote the last owner — promote another owner first',
          );
        }
      }

      await ctx.db
        .update(memberships)
        .set({ role: input.role })
        .where(
          and(
            eq(memberships.restaurantId, input.restaurantId),
            eq(memberships.userId, input.userId),
          ),
        );
      await recordAudit(ctx.db, {
        restaurantId: input.restaurantId,
        userId: ctx.session.userId,
        action: 'admin.role_set',
        entityType: 'user',
        entityId: input.userId,
        before: { role: current.role },
        after: { role: input.role },
      });
      return { ok: true as const };
    }),

  /** Marketing-landing leads (admin-only — tenants can't read these). */
  listLeads: adminProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(leads)
        .orderBy(desc(leads.createdAt))
        .limit(input?.limit ?? 100);
      // Leads belong to no tenant and audit_log.restaurant_id is NOT NULL, so this
      // read is logged as a structured server line instead of an audit row.
      console.info(
        JSON.stringify({ audit: 'admin.viewed', entityType: 'leads', userId: ctx.session.userId, count: rows.length }),
      );
      return rows;
    }),
});
