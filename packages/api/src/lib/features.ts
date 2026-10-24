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
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

interface FeatureSettings {
  features?: Partial<Record<FeatureKey | 'all', boolean>>;
}

function killed(key: FeatureKey, env: NodeJS.ProcessEnv): boolean {
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
  if (!features) return false;
  return features[key] === true || (features.all === true && features[key] !== false);
}
