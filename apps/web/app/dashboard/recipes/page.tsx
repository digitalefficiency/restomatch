import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { RecipesHome } from './recipes-home';
import { PeriodCard } from '../inventory/period-card';

/**
 * Food cost per dish (wave 1, flag `recipes`). Owner / manager / chef (route
 * roles in lib/roles.ts). A restaurant without the flag gets a 404 — the
 * feature is invisible, not "locked".
 */
export default async function RecipesPage() {
  const caller = await createServerCaller();
  const { enabled } = await caller.recipes.enabled();
  if (!enabled) notFound();
  const [initial, memberships, session, t, inventoryFlag] = await Promise.all([
    caller.recipes.list(),
    caller.onboarding.myMemberships(),
    auth(),
    getT(recipesNs),
    caller.inventory.enabled().catch(() => ({ enabled: false })),
  ]);
  const active = memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const canSetTarget = active?.role === 'owner' || active?.role === 'manager';
  // IA-02 (W3-02): inventory.period is owner/manager only (all ₪). Rendering the
  // card for the chef gave her an error card at the top of "עלות מנה"; she sees
  // the dishes first instead, and no ₪ query leaves her browser.
  const showPeriod = inventoryFlag.enabled && canSetTarget;
  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />
      {/* Actual food cost from inventory counts (flag `inventoryCount`, owner/manager): its own KPI, next to food cost per dish. */}
      {showPeriod ? (
        <div className="mb-6">
          <PeriodCard compact />
        </div>
      ) : null}
      <RecipesHome initial={initial} canSetTarget={canSetTarget} />
    </div>
  );
}
