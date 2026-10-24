import { eq, restaurants, type Database } from '@restomatch/db';
import { appError } from '../errors';
import { featureEnabled, type FeatureKey } from './features';

/**
 * Wave-1 flag check for a procedure (MASTER-PLAN §1.3): reads the session
 * restaurant's `settings` under RLS and throws FORBIDDEN / FEATURE_DISABLED
 * when the feature is off for it (or killed by FEATURES_OFF).
 */
export async function isFeatureOn(db: Database, restaurantId: string, key: FeatureKey): Promise<boolean> {
  const [row] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return featureEnabled(row?.settings, key);
}

export async function assertFeature(db: Database, restaurantId: string, key: FeatureKey): Promise<void> {
  if (!(await isFeatureOn(db, restaurantId, key))) {
    throw appError('FORBIDDEN', 'FEATURE_DISABLED', `הפיצ'ר ${key} אינו פעיל למסעדה זו.`, { feature: key });
  }
}
