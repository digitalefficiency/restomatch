/**
 * Per-restaurant feature flags for the post-demo feature wave (MASTER-PLAN §3).
 *
 * A flag lives in `restaurants.settings.features` (jsonb — no schema change):
 *   { "features": { "contracts": true } }   one feature on
 *   { "features": { "all": true } }         every feature on (the seeded demo tenant)
 * Everything is OFF unless a restaurant opts in. `FEATURES_OFF` is the
 * production kill-switch: `FEATURES_OFF=all` or `FEATURES_OFF=contracts,aiAssistant`
 * turns features off for every tenant without a deploy of code.
 */
export const FEATURE_KEYS = [
  'chain',
  'dashViews',
  'priceDisparity',
  'chainAlerts',
  'contracts',
  'priceAlerts',
  'recovery',
  'monthlyReport',
  'ingestWhatsapp',
  'ingestEmail',
  'receiverPwa',
  'receiverLanguages',
  'aiAssistant',
  'leakCheck',
  'recipes',
  'integrations',
  'payRun',
  'dockSlip',
  'consolidatedMatch',
  // Wave-1 keys (appended after main's order).
  // In-app preview of the monthly email (S12, demo 2026-10-25). Read-only: no send.
  'monthlyDigestPreview',
  'growth',
  // S17: alert on a dish whose food cost crossed the target because a supplier raised a price.
  'dishPriceAlert',
  'orderPricesOut',
  'supplierConfirm',
  'dockPriceContext',
  'orderCapture',
  // "How did we get to ₪X?" proof sheet under the dashboard hero (S12). Read-only, no new ₪ math.
  'leakProof',
  'vatAtRisk',
  'supplierLeakCard',
  'supplierLedger',
  // S17: inventory counting (ספירת מלאי) → actual food cost per period.
  'inventoryCount',
  // G-08: name-only ORDER lines are "זה אותו מוצר?" questions (they hold the match).
  // DEFAULT ON — the kill switch: settings.features.orderQuestions = false (admin;
  // it also releases the invoices already held), or FEATURES_OFF=orderQuestions
  // (redeploy, then `pnpm --filter @restomatch/worker run release-order-holds`).
  // Invoice-line questions and charge lines stay on. Notes:
  //   - FEATURES_OFF=all kills it too: name-only order lines are then as on main
  //     before G-08 (a first match can read them MISSING + UNORDERED);
  //   - the charts read FEATURES_OFF at boot (on Vercel an env change redeploys anyway);
  //   - turning it back ON does not re-hold invoices matched while it was OFF;
  //   - a re-hold also hides the run's other open findings until the answer
  //     (by design — the answer re-matches).
  'orderQuestions',
] as const;

/** Keys that are ON unless a restaurant sets them false (or FEATURES_OFF kills them). */
export const DEFAULT_ON_FEATURES: readonly FeatureKey[] = ['orderQuestions'];

export type FeatureKey = (typeof FEATURE_KEYS)[number];

interface FeatureSettings {
  features?: Partial<Record<FeatureKey | 'all', boolean>>;
}

export function killed(key: FeatureKey, env: NodeJS.ProcessEnv = process.env): boolean {
  const off = env.FEATURES_OFF?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return off.includes('all') || off.includes(key);
}

/** True when `key` is enabled for a restaurant whose `settings` jsonb is given. */
export function featureEnabled(
  settings: unknown,
  key: FeatureKey,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (killed(key, env)) return false;
  const features = (settings as FeatureSettings | null | undefined)?.features;
  if (DEFAULT_ON_FEATURES.includes(key)) return features?.[key] !== false;
  if (!features) return false;
  return features[key] === true || (features.all === true && features[key] !== false);
}

/**
 * AU-01 (owner decision AD2): the flags an owner may switch on or off for their
 * own restaurant from /dashboard/settings/automations. Everything else stays
 * admin-only (FeaturesPanel). The FEATURES_OFF kill-switch still wins: a
 * stored owner wish never overrides it.
 */
export const OWNER_TOGGLEABLE = [
  'priceAlerts',
  'recovery',
  'monthlyReport',
  'vatAtRisk',
  'supplierLedger',
  'monthlyDigestPreview',
  'dishPriceAlert',
] as const satisfies ReadonlyArray<FeatureKey>;

export type OwnerToggleableKey = (typeof OWNER_TOGGLEABLE)[number];

