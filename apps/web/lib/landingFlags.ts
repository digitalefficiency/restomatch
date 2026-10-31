/**
 * Feature flags for the public landing page.
 *
 * The per-restaurant flags (`@restomatch/api` `featureEnabled`) live on a
 * tenant's settings — an anonymous visitor has none — so landing flags are
 * deploy-level env instead, read per request (the landing is dynamic):
 *   LANDING_FLAGS=landingOrdersStory     one flag on
 * Everything is OFF unless listed. `FEATURES_OFF` (the same production
 * kill-switch the tenant flags honour) wins: `FEATURES_OFF=all` or
 * `FEATURES_OFF=landingOrdersStory` turns it off again.
 */
export const LANDING_FLAG_KEYS = ['landingOrdersStory', 'landingCompare'] as const;

export type LandingFlag = (typeof LANDING_FLAG_KEYS)[number];

const list = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

export function landingFlag(
  key: LandingFlag,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const off = list(env.FEATURES_OFF);
  if (off.includes('all') || off.includes(key)) return false;
  return list(env.LANDING_FLAGS).includes(key);
}
