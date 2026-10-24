import Link from 'next/link';
import { ArrowLeft, ChefHat } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { Card } from '@/lib/components';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatNumber } from '@/lib/i18n/format';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { originalProps } from '@/lib/i18n/original';
import { ils, ilsDelta, pct } from './recipe-ui';
import { PriceAlertLine } from './price-alert';

const TOP = 3;

/**
 * Owner-overview card: dishes whose cost per plate rose since the start of the
 * month (wave 1, flag `recipes`). Renders nothing when the flag is off or the
 * caller cannot see recipes — the feature stays invisible. Server component;
 * reuses the request-scoped caller.
 */
export async function RecipesOverviewCard() {
  const caller = await createServerCaller();
  const { enabled } = await caller.recipes.enabled().catch(() => ({ enabled: false }));
  if (!enabled) return null;
  const changes = await caller.recipes.changes().catch((err: unknown) => {
    // The card is optional — never break the overview — but don't hide real bugs either.
    console.error('[recipes-overview-card] recipes.changes failed', err);
    return null;
  });
  if (!changes) return null;
  const [t, locale, alertsRes] = await Promise.all([
    getT(recipesNs),
    getLocale(),
    // Flag `dishPriceAlert`: with it off this is { enabled: false } and the card is unchanged.
    caller.recipes.priceAlerts().catch(() => null),
  ]);
  const alertById = new Map((alertsRes?.enabled ? alertsRes.alerts : []).map((a) => [a.recipeId, a] as const));
  // Dishes on the menu only (an archived dish is not "hurting" anyone).
  const hurt = changes.rows.filter((r) => r.active && !r.isSubRecipe && r.costDeltaAgorot > 0);
  const noRecipes = changes.activeDishCount === 0;
  const top = hurt.slice(0, TOP);
  return (
    <Card className="mt-8" data-testid="recipes-overview-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-xl bg-surface-2 p-2 text-gold" aria-hidden="true">
            <ChefHat className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">{t('overviewCard.title')}</h2>
            <p className="text-sm text-muted">
              {noRecipes
                ? t('overviewCard.empty')
                : hurt.length
                  ? t('overviewCard.count', { count: formatNumber(hurt.length, locale) })
                  : t('overviewCard.none')}
            </p>
            {hurt.length ? <p className="text-xs text-subtle">{t('overviewCard.subtitle')}</p> : null}
          </div>
        </div>
        <Link
          href="/dashboard/recipes"
          className="touch-target inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {t('overviewCard.open')}
          <ArrowLeft className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
        </Link>
      </div>
      {top.length ? (
        <ul className="mt-4 divide-y divide-line">
          {top.map((r) => (
            <li key={r.recipeId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <Link href={`/dashboard/recipes/${r.recipeId}`} className="touch-target inline-flex items-center font-medium text-ink hover:text-primary">
                {locale === 'en' && r.nameEn ? r.nameEn : <span {...originalProps(r.name)}>{r.name}</span>}
              </Link>
              <span className="flex items-center gap-4 text-muted">
                {r.beforeFoodCostBp != null ? (
                  <bdi dir="ltr" className="tabular-nums">
                    <bdi>{pct(r.beforeFoodCostBp, locale)}</bdi> → <bdi>{pct(r.afterFoodCostBp, locale)}</bdi>
                  </bdi>
                ) : (
                  <bdi dir="ltr" className="tabular-nums">
                    <bdi>{ils(r.beforeCostAgorot, locale)}</bdi> → <bdi>{ils(r.afterCostAgorot, locale)}</bdi>
                  </bdi>
                )}
                {/* A rising cost per plate is a warning; only a dish that CROSSED its target gets the T2 badge below. */}
                <span className="font-semibold text-warn">
                  <bdi dir="ltr" className="tabular-nums">{ilsDelta(r.costDeltaAgorot, locale)}</bdi>{' '}
                  <span className="text-xs font-normal text-subtle">{t('overviewCard.perPlate')}</span>
                </span>
              </span>
              {alertById.has(r.recipeId) && alertsRes?.enabled ? (
                <PriceAlertLine alert={alertById.get(r.recipeId)!} targetBp={alertsRes.targetBp} compact causeOnly className="w-full" />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
