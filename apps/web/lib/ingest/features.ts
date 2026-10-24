import 'server-only';
import { FEATURE_KEYS, featureEnabled, type FeatureKey } from '@restomatch/api';
import { eq, restaurants, withRestaurant } from '@restomatch/db';
import { db } from '@/lib/db';

/**
 * The wave-1 features enabled for a restaurant (flags in restaurants.settings,
 * FEATURES_OFF kill-switch applied). Read under the restaurant GUC (RLS).
 * Used by the dashboard shell to hide nav entries of disabled features.
 */
export async function enabledFeatures(restaurantId: string | null | undefined): Promise<FeatureKey[]> {
  if (!restaurantId) return [];
  try {
    const [row] = await withRestaurant(db, restaurantId, (tx) =>
      tx.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1),
    );
    return FEATURE_KEYS.filter((k) => featureEnabled(row?.settings, k));
  } catch {
    return [];
  }
}
