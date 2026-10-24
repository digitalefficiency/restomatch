import { randomInt } from 'node:crypto';
import { z } from 'zod';
import {
  and,
  count,
  eq,
  plans,
  PLAN_SEED,
  PLAN_SEED_LIST,
  referralCodes,
  referralRedemptions,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import {
  chainMonthlyAgorot,
  MAX_CHAIN_BRANCHES,
  quotePlan,
  referralCreditAgorot,
  type PlanQuote,
} from '@restomatch/billing';
import { appError } from '../errors';
import { getEntitlements } from '../entitlements';
import { featureEnabled } from '../lib/features';
import { managerProcedure, ownerProcedure, publicProcedure, router } from '../trpc';

/**
 * Growth (wave 1, S15 — flag `growth`): chain per-branch pricing + annual
 * billing quotes, and the referral program (one month free for both sides).
 *
 * Money: every amount is integer agorot from @restomatch/billing (human-review
 * money module). Referral credits are RECORDED only — nothing is charged or paid
 * out (no PSP). A redemption starts 'pending'; `creditReferralRedemption` (owner
 * /service connection) fills both credits when the referred restaurant converts.
 */

/** Public pricing gate: env opt-in plus the global kill-switch. */
export function growthPricingPublicEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.GROWTH_PRICING_PUBLIC !== '1') return false;
  return featureEnabled({ features: { growth: true } }, 'growth', env);
}

/** A restaurant may redeem a code only within this many days of its creation. */
export const REFERRAL_REDEEM_WINDOW_DAYS = 30;

// No 0/O/1/I — codes are read aloud and typed from WhatsApp.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateReferralCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

async function assertGrowthEnabled(db: Database, restaurantId: string): Promise<{ createdAt: Date }> {
  const [r] = await db
    .select({ settings: restaurants.settings, createdAt: restaurants.createdAt })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!r || !featureEnabled(r.settings, 'growth')) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'התכונה אינה פעילה למסעדה זו');
  }
  return { createdAt: r.createdAt };
}

/**
 * A restaurant's own monthly price in agorot: its plan's list price, or — for
 * chain — the per-branch total at the account's branch count. Trial = 0.
 * Runs on the owner/service connection (reads the billing account's branches).
 */
export async function restaurantMonthlyPriceAgorot(db: Database, restaurantId: string): Promise<number> {
  const ent = await getEntitlements(db, restaurantId);
  const [planRow] = await db
    .select({ price: plans.priceAgorotMonthly })
    .from(plans)
    .where(eq(plans.key, ent.planKey))
    .limit(1);
  const list = planRow?.price ?? PLAN_SEED[ent.planKey].priceAgorotMonthly;
  if (ent.planKey !== 'chain') return list;
  let branches = 1;
  if (ent.billingAccountId) {
    const [c] = await db
      .select({ n: count() })
      .from(restaurants)
      .where(eq(restaurants.billingAccountId, ent.billingAccountId));
    branches = Math.min(Math.max(c?.n ?? 1, 1), MAX_CHAIN_BRANCHES);
  }
  return chainMonthlyAgorot(list, branches);
}

/**
 * Credit a pending redemption: each side gets one month of ITS OWN price.
 * Owner/service connection only (the app role cannot UPDATE redemptions).
 * Idempotent: an already-credited row is returned unchanged.
 */
export async function creditReferralRedemption(db: Database, redemptionId: string, now: Date = new Date()) {
  const [row] = await db
    .select()
    .from(referralRedemptions)
    .where(eq(referralRedemptions.id, redemptionId))
    .limit(1);
  if (!row) return null;
  if (row.status === 'credited') return row;
  const referrer = referralCreditAgorot(await restaurantMonthlyPriceAgorot(db, row.referrerRestaurantId));
  const referred = referralCreditAgorot(await restaurantMonthlyPriceAgorot(db, row.referredRestaurantId));
  const [updated] = await db
    .update(referralRedemptions)
    .set({ status: 'credited', creditAgorotReferrer: referrer, creditAgorotReferred: referred, creditedAt: now })
    .where(and(eq(referralRedemptions.id, redemptionId), eq(referralRedemptions.status, 'pending')))
    .returning();
  return updated ?? row;
}

const PricingInput = z
  .object({
    cycle: z.enum(['monthly', 'annual']).default('monthly'),
    branches: z.number().int().min(1).max(MAX_CHAIN_BRANCHES).default(1),
  })
  .default({});

export const growthRouter = router({
  /** Public pricing quote (pure). Off unless GROWTH_PRICING_PUBLIC=1 and not killed. */
  pricing: publicProcedure.input(PricingInput).query(async ({ ctx, input }) => {
    if (!growthPricingPublicEnabled()) return { enabled: false as const };
    let rows: Array<{ key: string; priceAgorotMonthly: number }>;
    try {
      rows = await ctx.db
        .select({ key: plans.key, priceAgorotMonthly: plans.priceAgorotMonthly })
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(plans.sortOrder);
    } catch {
      rows = [];
    }
    if (rows.length === 0) rows = PLAN_SEED_LIST;
    const quotes: PlanQuote[] = rows.map((p) => quotePlan(p, input.cycle, input.branches));
    return { enabled: true as const, cycle: input.cycle, branches: input.branches, plans: quotes };
  }),

  /** The caller's referral code (created on first call). */
  myReferral: managerProcedure.query(async ({ ctx }) => {
    const restaurantId = ctx.session.restaurantId;
    await assertGrowthEnabled(ctx.db, restaurantId);
    const [existing] = await ctx.db
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(eq(referralCodes.restaurantId, restaurantId))
      .limit(1);
    if (existing) return { code: existing.code };
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode();
      const inserted = await ctx.db
        .insert(referralCodes)
        .values({ restaurantId, code })
        .onConflictDoNothing()
        .returning({ code: referralCodes.code });
      if (inserted[0]) return { code: inserted[0].code };
      // Conflict on restaurant_id (a concurrent call won) → return that one.
      const [raced] = await ctx.db
        .select({ code: referralCodes.code })
        .from(referralCodes)
        .where(eq(referralCodes.restaurantId, restaurantId))
        .limit(1);
      if (raced) return { code: raced.code };
    }
    throw new Error('could not allocate a referral code');
  }),

  /** A NEW restaurant (≤ 30 days old) redeems someone else's code, once. */
  redeemReferral: ownerProcedure
    .input(z.object({ code: z.string().trim().min(6).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const { createdAt } = await assertGrowthEnabled(ctx.db, restaurantId);
      const code = input.code.toUpperCase();
      if (!/^[A-Z0-9]{6,16}$/.test(code)) {
        throw appError('BAD_REQUEST', 'growth.referralInvalid', 'קוד ההפניה אינו תקין');
      }
      const ageMs = Date.now() - createdAt.getTime();
      if (ageMs > REFERRAL_REDEEM_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
        throw appError('BAD_REQUEST', 'growth.referralInvalid', 'אפשר לממש קוד הפניה רק בחודש הראשון');
      }
      const [already] = await ctx.db
        .select({ id: referralRedemptions.id })
        .from(referralRedemptions)
        .where(eq(referralRedemptions.referredRestaurantId, restaurantId))
        .limit(1);
      if (already) {
        throw appError('CONFLICT', 'growth.referralAlreadyRedeemed', 'כבר מומש קוד הפניה למסעדה זו');
      }
      // SECURITY DEFINER lookup (0055): resolves the referrer without exposing
      // other tenants' referral_codes rows to this tenant.
      const resolved = await ctx.db.execute(sql`select app.resolve_referral_code(${code}) as id`);
      const referrerId = (resolved as unknown as Array<{ id: string | null }>)[0]?.id ?? null;
      if (!referrerId) {
        throw appError('BAD_REQUEST', 'growth.referralInvalid', 'קוד ההפניה אינו תקין');
      }
      if (referrerId === restaurantId) {
        throw appError('BAD_REQUEST', 'growth.referralSelf', 'אי אפשר לממש את קוד ההפניה של עצמך');
      }
      // Anti-abuse: the same people on both sides (an owner opening a second
      // restaurant to refer themselves) and A↔B swaps between two new
      // restaurants are not referrals. Membership overlap is checked on the owner
      // connection (read-only; RLS hides the other tenant's memberships).
      const overlap = (await (ctx.adminDb ?? ctx.db).execute(sql`
        select 1 from memberships a join memberships b on b.user_id = a.user_id
        where a.restaurant_id = ${restaurantId} and b.restaurant_id = ${referrerId} limit 1`)) as unknown as unknown[];
      if (overlap.length > 0) {
        throw appError('BAD_REQUEST', 'growth.referralSelf', 'אי אפשר לממש קוד הפניה של מסעדה שאתם חברים בה');
      }
      const [mutual] = await ctx.db
        .select({ id: referralRedemptions.id })
        .from(referralRedemptions)
        .where(
          and(
            eq(referralRedemptions.referrerRestaurantId, restaurantId),
            eq(referralRedemptions.referredRestaurantId, referrerId),
          ),
        )
        .limit(1);
      if (mutual) {
        throw appError('BAD_REQUEST', 'growth.referralSelf', 'אי אפשר להפנות הדדית');
      }
      const inserted = await ctx.db
        .insert(referralRedemptions)
        .values({ code, referrerRestaurantId: referrerId, referredRestaurantId: restaurantId })
        .onConflictDoNothing()
        .returning({ id: referralRedemptions.id, status: referralRedemptions.status });
      if (!inserted[0]) {
        throw appError('CONFLICT', 'growth.referralAlreadyRedeemed', 'כבר מומש קוד הפניה למסעדה זו');
      }
      return { ok: true as const, status: inserted[0].status };
    }),

  /** Redemptions of the caller's code + the caller's own redemption. */
  referralStats: managerProcedure.query(async ({ ctx }) => {
    const restaurantId = ctx.session.restaurantId;
    await assertGrowthEnabled(ctx.db, restaurantId);
    const given = await ctx.db
      .select({
        status: referralRedemptions.status,
        creditAgorot: referralRedemptions.creditAgorotReferrer,
        createdAt: referralRedemptions.createdAt,
      })
      .from(referralRedemptions)
      .where(eq(referralRedemptions.referrerRestaurantId, restaurantId))
      .orderBy(referralRedemptions.createdAt);
    const [own] = await ctx.db
      .select({
        status: referralRedemptions.status,
        creditAgorot: referralRedemptions.creditAgorotReferred,
      })
      .from(referralRedemptions)
      .where(eq(referralRedemptions.referredRestaurantId, restaurantId))
      .limit(1);
    return {
      referred: given.length,
      pending: given.filter((g) => g.status === 'pending').length,
      credited: given.filter((g) => g.status === 'credited').length,
      earnedAgorot: given.reduce((acc, g) => acc + (g.creditAgorot ?? 0), 0),
      redeemed: own ? { status: own.status, creditAgorot: own.creditAgorot } : null,
    };
  }),
});
