import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { RecipesHome } from './recipes-home';

/**
 * Food cost per dish (wave 1, flag `recipes`). Owner / manager / chef (route
 * roles in lib/roles.ts). A restaurant without the flag gets a 404 — the
 * feature is invisible, not "locked".
 */
export default async function RecipesPage() {
  const caller = await createServerCaller();
  const { enabled } = await caller.recipes.enabled();
  if (!enabled) notFound();
  const [initial, memberships, session, t] = await Promise.all([
    caller.recipes.list(),
    caller.onboarding.myMemberships(),
    auth(),
    getT(recipesNs),
  ]);
  const active = memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canSetTarget = active?.role === 'owner' || active?.role === 'manager';
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      <RecipesHome initial={initial} canSetTarget={canSetTarget} />
    </div>
  );
}
