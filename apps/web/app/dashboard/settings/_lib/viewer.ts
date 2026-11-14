import 'server-only';
import { cache } from 'react';
import type { UserRole } from '@restomatch/db';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { enabledFeatures } from '@/lib/ingest/features';

export interface SettingsViewer {
  userId: string | null;
  restaurantId: string | null;
  role: UserRole | null;
  isOwner: boolean;
  /** Owner, manager and bookkeeper see the restaurant group (owner edits; the others read, as before). */
  seesRestaurant: boolean;
  features: string[];
}

/**
 * The caller on the active restaurant, resolved the way the dashboard layout
 * resolves it (session restaurant, else the first membership). Cached per
 * request: the settings layout and the section page share one lookup.
 */
export const settingsViewer = cache(async (): Promise<SettingsViewer> => {
  const [caller, session] = await Promise.all([createServerCaller(), auth()]);
  const memberships = await caller.onboarding.myMemberships();
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const role = (active?.role ?? null) as UserRole | null;
  const features = active?.restaurantId ? await enabledFeatures(active.restaurantId) : [];
  return {
    userId: session?.user?.id ?? null,
    restaurantId: active?.restaurantId ?? null,
    role,
    isOwner: role === 'owner',
    seesRestaurant: role === 'owner' || role === 'manager' || role === 'bookkeeper',
    features,
  };
});
