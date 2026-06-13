import {
  and,
  eq,
  PLAN_SEED,
  plans,
  restaurants,
  sql,
  subscriptions,
  usageCounters,
  type Database,
  type FeatureKey,
  type PlanLimits,
} from '@restomatch/db';

export type UsageMetric = 'ocr_scans' | 'whatsapp_sends';

export interface Entitlements {
  billingAccountId: string | null;
  planKey: 'trial' | 'basic' | 'pro' | 'chain';
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
  /** Whether the subscription currently grants access (trial not expired, not past_due/canceled). */
  active: boolean;
  limits: PlanLimits;
  features: FeatureKey[];
}

/** YYYY-MM bucket for usage counters. */
export function usagePeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function mergeLimits(base: PlanLimits, override?: Partial<PlanLimits>): PlanLimits {
  if (!override) return base;
  return {
    invoicesPerMonth: override.invoicesPerMonth ?? base.invoicesPerMonth,
    restaurants: override.restaurants ?? base.restaurants,
    seatsPerRestaurant: override.seatsPerRestaurant ?? base.seatsPerRestaurant,
  };
}

/**
 * Resolve the effective entitlements for a restaurant.
 *
 * No billing account / no subscription ⇒ implicit TRIAL (Pro features, low
 * volume) so a restaurant is usable from the first login; admin assigns a paid
 * plan later. An expired trial or past_due/canceled subscription ⇒ inactive
 * (no features, zero quota) until resolved.
 */
export async function getEntitlements(
  db: Database,
  restaurantId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const [r] = await db
    .select({ billingAccountId: restaurants.billingAccountId })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const billingAccountId = r?.billingAccountId ?? null;
  if (!billingAccountId) return implicitTrial(null);

  const [sub] = await db
    .select({
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      overrides: subscriptions.overrides,
      planKey: plans.key,
      planLimits: plans.limits,
      planFeatures: plans.features,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.billingAccountId, billingAccountId))
    .limit(1);

  if (!sub) return implicitTrial(billingAccountId);

  const limits = mergeLimits(sub.planLimits, sub.overrides?.limits);
  const baseFeatures = sub.overrides?.features ?? sub.planFeatures;

  const trialExpired =
    sub.status === 'trialing' &&
    sub.trialEndsAt !== null &&
    sub.trialEndsAt.getTime() <= now.getTime();
  const active = !trialExpired && (sub.status === 'active' || sub.status === 'trialing');

  return {
    billingAccountId,
    planKey: sub.planKey,
    status: trialExpired ? 'past_due' : sub.status,
    active,
    limits,
    features: active ? baseFeatures : [],
  };
}

function implicitTrial(billingAccountId: string | null): Entitlements {
  const seed = PLAN_SEED.trial;
  return {
    billingAccountId,
    planKey: 'trial',
    status: 'trialing',
    active: true,
    limits: seed.limits,
    features: seed.features,
  };
}

export interface QuotaState {
  /** false when the restaurant has no billing account (implicit trial, untracked). */
  metered: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  withinLimit: boolean;
}

/** Current usage vs the plan limit for a metric. */
export async function getQuota(
  db: Database,
  restaurantId: string,
  metric: UsageMetric,
  now: Date = new Date(),
): Promise<QuotaState> {
  const ent = await getEntitlements(db, restaurantId, now);
  if (!ent.billingAccountId) {
    return { metered: false, used: 0, limit: null, remaining: null, withinLimit: true };
  }

  const used = await readUsage(db, ent.billingAccountId, metric, now);

  // Inactive subscription (expired trial / past_due / canceled) ⇒ hard block.
  if (!ent.active) {
    return { metered: true, used, limit: 0, remaining: 0, withinLimit: false };
  }

  const limit = metricLimit(ent, metric);
  const withinLimit = limit === null ? true : used < limit;
  return {
    metered: true,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    withinLimit,
  };
}

async function readUsage(
  db: Database,
  billingAccountId: string,
  metric: UsageMetric,
  now: Date,
): Promise<number> {
  const [counter] = await db
    .select({ used: usageCounters.used })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.billingAccountId, billingAccountId),
        eq(usageCounters.period, usagePeriod(now)),
        eq(usageCounters.metric, metric),
      ),
    )
    .limit(1);
  return counter?.used ?? 0;
}

function metricLimit(ent: Entitlements, metric: UsageMetric): number | null {
  switch (metric) {
    case 'ocr_scans':
      return ent.limits.invoicesPerMonth;
    case 'whatsapp_sends':
      return null; // gated by the whatsapp_alerts feature, not volume-capped
  }
}

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    readonly metric: UsageMetric,
    readonly limit: number | null,
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Authoritative OCR metering, called by the worker before processing a scan.
 *
 * Race-safe by construction: the counter is incremented atomically and the
 * scan is allowed iff the NEW value is within the limit. N concurrent calls
 * therefore admit at most `limit` of them — there is no read-then-write window
 * an attacker could exploit to exceed a paid cap. No-op when the restaurant has
 * no billing account (implicit trial, untracked).
 */
export async function meterOcrScan(
  db: Database,
  restaurantId: string,
  now: Date = new Date(),
): Promise<{ metered: boolean; used: number; limit: number | null }> {
  const ent = await getEntitlements(db, restaurantId, now);
  if (!ent.billingAccountId) return { metered: false, used: 0, limit: null };
  if (!ent.active) {
    throw new QuotaExceededError('המנוי אינו פעיל — נדרש חידוש', 'ocr_scans', 0);
  }
  const limit = ent.limits.invoicesPerMonth;
  const used = await recordUsage(db, ent.billingAccountId, 'ocr_scans', now);
  if (limit !== null && used > limit) {
    throw new QuotaExceededError(
      `חרגתם ממכסת הסריקות החודשית (${limit}). שדרגו את המנוי כדי להמשיך.`,
      'ocr_scans',
      limit,
    );
  }
  return { metered: true, used, limit };
}

/**
 * Atomically increment a usage counter for the current period and return the
 * new value. Authoritative metering happens at the worker (owner connection),
 * never the client, so it cannot be bypassed by skipping the web pre-check.
 */
export async function recordUsage(
  db: Database,
  billingAccountId: string,
  metric: UsageMetric,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .insert(usageCounters)
    .values({ billingAccountId, period: usagePeriod(now), metric, used: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.billingAccountId, usageCounters.period, usageCounters.metric],
      set: { used: sql`${usageCounters.used} + 1` },
    })
    .returning({ used: usageCounters.used });
  return row?.used ?? 0;
}
