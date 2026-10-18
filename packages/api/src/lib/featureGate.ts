import { eq, restaurants, type Database } from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled, type FeatureKey } from './features';

/**
 * Throw FORBIDDEN (appCode FEATURE_DISABLED) unless `key` is on for the
 * restaurant. Call at the top of every procedure of a flag-gated feature; runs
 * inside the member RLS transaction (the restaurant row is GUC-visible).
 */
export async function assertFeature(db: Database, restaurantId: string, key: FeatureKey): Promise<void> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!featureEnabled(r?.settings, key)) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', `התכונה "${key}" אינה פעילה למסעדה זו`, { feature: key });
  }
}
