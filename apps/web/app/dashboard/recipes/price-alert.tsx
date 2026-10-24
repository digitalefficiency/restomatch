'use client';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { TrendingUp } from 'lucide-react';
import { Badge, cn } from '@/lib/components';
import { formatPercent } from '@/lib/i18n/format';
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
 * `causeOnly` = the row already shows before → after and ₪ per plate (overview
 * card): state the crossing and its cause, without repeating the numbers.
 */
export function PriceAlertLine({ alert: a, targetBp, compact = false, causeOnly = false, className }: {
  alert: DishPriceAlert;
  targetBp: number;
  compact?: boolean;
  causeOnly?: boolean;
  className?: string;
}) {
  const t = useT(recipesNs);
  const locale = useLocale();
  const changeText = `${pct(a.product.priceChangeBp, locale)}`;
  // A just-over crossing (30.00% → 30.04%) must not read "30% → 30%": add a decimal.
  const onePlace = new Set([pct(a.beforeFoodCostBp, locale), pct(a.afterFoodCostBp, locale), pct(targetBp, locale)]).size === 3;
  const fc = (bp: number) => (onePlace ? pct(bp, locale) : formatPercent(bp / 10_000, locale, 2));
  return (
    <div
      role={compact ? undefined : 'alert'}
      data-testid="dish-price-alert"
      // Tier T2 (act now): a solid danger badge says "crossed"; the details stay ink/muted.
      className={cn(
        'text-ink',
        compact ? 'mt-1 text-xs' : 'rounded-xl border border-danger/35 bg-danger/8 p-3 text-sm',
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
        {causeOnly ? (
          <Badge tone="danger-solid" icon={<TrendingUp className="h-3 w-3" aria-hidden="true" />}>
            {t('alert.crossed', { target: pct(targetBp, locale) })}
          </Badge>
        ) : (
          <>
            <Badge tone="danger-solid" icon={<TrendingUp className="h-3 w-3" aria-hidden="true" />}>
              {t('alert.title')}
            </Badge>
            <Arrow from={fc(a.beforeFoodCostBp)} to={fc(a.afterFoodCostBp)} />
            <span className="font-normal text-muted">({t('alert.target', { target: pct(targetBp, locale) })})</span>
            <span>
              · <bdi dir="ltr" className="tabular-nums">+{ils(a.costDeltaAgorot, locale)}</bdi> {t('alert.perPlate')}
            </span>
          </>
        )}
      </p>
      <p className={cn('text-muted', compact ? '' : 'mt-1')}>
        {localName(a.product.name, a.product.nameEn, locale)}{' '}
        <bdi dir="ltr" className="tabular-nums font-semibold text-warn">+{changeText}</bdi>{' '}
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
