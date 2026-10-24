'use client';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { recipes as recipesNs } from '@/lib/i18n/messages/recipes';
import { originalProps } from '@/lib/i18n/original';
import { ils, pct, priceText } from './recipe-ui';

export type DishPriceAlert = inferRouterOutputs<AppRouter>['recipes']['priceAlerts']['alerts'][number];

/** "before → after": isolated LTR so RLM marks in Hebrew ₪/% strings can't reorder it. */
function Arrow({ from, to }: { from: string; to: string }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      <bdi>{from}</bdi> → <bdi>{to}</bdi>
    </bdi>
  );
}

function localName(he: string, en: string | null, locale: string) {
  const text = locale === 'en' && en ? en : he;
  return <span {...originalProps(text)}>{text}</span>;
}

/**
 * Dish price alert (flag `dishPriceAlert`): the dish crossed the food-cost
 * target this month because a supplier raised an ingredient's price.
 * `compact` = one line under a dish name; otherwise a banner (editor).
 */
export function PriceAlertLine({ alert: a, targetBp, compact = false, className }: {
  alert: DishPriceAlert;
  targetBp: number;
  compact?: boolean;
  className?: string;
}) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const changeText = `${pct(a.product.priceChangeBp, locale)}`;
  return (
    <div
      role={compact ? undefined : 'alert'}
      data-testid="dish-price-alert"
      className={cn(
        'text-danger',
        compact ? 'mt-1 text-xs' : 'rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm',
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
        <TrendingUp className={compact ? 'h-3 w-3' : 'h-4 w-4'} aria-hidden="true" />
        <span>{t('alert.title')}</span>
        <Arrow from={pct(a.beforeFoodCostBp, locale)} to={pct(a.afterFoodCostBp, locale)} />
        <span className="font-normal text-muted">({t('alert.target', { target: pct(targetBp, locale) })})</span>
        <span>
          · <bdi dir="ltr" className="tabular-nums">+{ils(a.costDeltaAgorot, locale)}</bdi> {t('alert.perPlate')}
        </span>
      </p>
      <p className={cn('text-muted', compact ? '' : 'mt-1')}>
        {localName(a.product.name, a.product.nameEn, locale)}{' '}
        <bdi dir="ltr" className="tabular-nums text-danger">+{changeText}</bdi>{' '}
        (<Arrow from={priceText(a.product.priceBefore, locale)} to={priceText(a.product.priceNow, locale)} />)
        {a.supplier ? (
          <>
            {' · '}
            {t('alert.supplier')} {localName(a.supplier.name, a.supplier.nameEn, locale)}
          </>
        ) : null}
      </p>
    </div>
  );
}
