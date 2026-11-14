/**
 * W3-07a · "פיצ׳רים פעילים": why each per-restaurant feature is on or off.
 * Pure (unit-tested). Mirrors featureEnabled() in packages/api/src/lib/features.ts:
 * the FEATURES_OFF kill-switch wins, then an explicit tenant flag, then the
 * demo tenant's `all`, then a key that is on by default.
 */
export interface FeatureStateLike {
  stored: Record<string, boolean | undefined>;
  all: boolean;
  defaultOn?: string[];
  effective: Record<string, boolean>;
  killed: string[];
}

export type FeatureSource = 'killed' | 'stored' | 'demo' | 'default' | 'none';

export function featureSource(state: FeatureStateLike, key: string): FeatureSource {
  if (state.killed.includes(key)) return 'killed';
  if (typeof state.stored[key] === 'boolean') return 'stored';
  if (state.all) return 'demo';
  if ((state.defaultOn ?? []).includes(key)) return 'default';
  return 'none';
}

/** Keys in effect for the tenant right now, in a stable order. */
export function activeFeatures(state: FeatureStateLike): string[] {
  return Object.keys(state.effective)
    .filter((k) => state.effective[k])
    .sort();
}
