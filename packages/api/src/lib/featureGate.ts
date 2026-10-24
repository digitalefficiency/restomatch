import { eq, restaurants, type Database } from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled, type FeatureKey } from './features';

/** True when a wave-1 feature flag is on for this restaurant (reads restaurants.settings). */
export async function isFeatureOn(db: Database, restaurantId: string, key: FeatureKey): Promise<boolean> {
  const [row] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return featureEnabled(row?.settings, key);
}

/**
 * Throw FORBIDDEN (appCode FEATURE_DISABLED) unless `key` is on for the
 * restaurant. Call at the top of every procedure of a flag-gated feature; runs
 * inside the member RLS transaction (the restaurant row is GUC-visible).
 */
export async function assertFeature(db: Database, restaurantId: string, key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(db, restaurantId, key))) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', `התכונה "${key}" אינה פעילה למסעדה זו`, { feature: key });
  }
}

/**
 * Throw FORBIDDEN / appCode FEATURE_DISABLED unless the flag is on
 * (MASTER-PLAN §1.3: a disabled feature's procedures are refused).
 */
export async function assertFeatureOn(db: Database, restaurantId: string, key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(db, restaurantId, key))) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', `התכונה ${key} אינה פעילה במסעדה זו`, { feature: key });
  }
}
