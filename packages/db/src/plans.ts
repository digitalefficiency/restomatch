import type { FeatureKey, PlanLimits } from './schema';

/**
 * Tier definitions — the single source of truth for the seed (packages/db
 * seed) and for the implicit-trial fallback. Prices are in agorot/month.
 *
 * Pricing rationale lives in docs (GTM): value-anchored to detected leak,
 * ≥75% gross margin per COSTS.md. Trial = Pro features at low volume so the
 * value is visible; conversion is on volume + features.
 */
export interface PlanSeed {
  key: 'trial' | 'basic' | 'pro' | 'chain';
  nameHe: string;
  priceAgorotMonthly: number;
  limits: PlanLimits;
  features: FeatureKey[];
  sortOrder: number;
}

const ALL_FEATURES: FeatureKey[] = [
  'integrations',
  'whatsapp_alerts',
  'advanced_analytics',
  'accounting_export',
];

export const PLAN_SEED: Record<PlanSeed['key'], PlanSeed> = {
  trial: {
    key: 'trial',
    nameHe: 'ניסיון',
    priceAgorotMonthly: 0,
    limits: { invoicesPerMonth: 100, restaurants: 1, seatsPerRestaurant: 5 },
    features: ALL_FEATURES,
    sortOrder: 0,
  },
  basic: {
    key: 'basic',
    nameHe: 'בסיס',
    priceAgorotMonthly: 34_900,
    limits: { invoicesPerMonth: 150, restaurants: 1, seatsPerRestaurant: 5 },
    features: [],
    sortOrder: 1,
  },
  pro: {
    key: 'pro',
    nameHe: 'מקצועי',
    priceAgorotMonthly: 59_000,
    limits: { invoicesPerMonth: 400, restaurants: 1, seatsPerRestaurant: 10 },
    features: ALL_FEATURES,
    sortOrder: 2,
  },
  chain: {
    key: 'chain',
    nameHe: 'רשת',
    priceAgorotMonthly: 149_000,
    limits: { invoicesPerMonth: 1500, restaurants: 5, seatsPerRestaurant: 25 },
    features: ALL_FEATURES,
    sortOrder: 3,
  },
};

export const PLAN_SEED_LIST: PlanSeed[] = Object.values(PLAN_SEED);
