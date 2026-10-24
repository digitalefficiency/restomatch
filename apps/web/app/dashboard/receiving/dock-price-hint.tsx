'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { formatPercent } from '@/lib/i18n/format';
import { dockPrice } from '@/lib/i18n/messages/dockPrice';
import { formatIls } from '@/lib/money';

/** Below this the % is noise — show the usual price alone. */
const MIN_SHOWN_PCT = 0.005;

export interface DockPriceHintData {
  usualUnitPrice: number;
  pctVsUsual: number;
  samples: number;
}

export const DOCK_PRICE_DAYS = 90;

/**
 * Flag `dockPriceContext`: the muted "your usual price: ₪p50 (90 days) · +x%"
 * sub-line under a price-higher line. Display only — the % comes from the
 * server's stored-history median and never feeds the leak math.
 */
export function DockPriceHint({ data }: { data: DockPriceHintData }) {
  const t = useT(dockPrice);
  const locale = useLocale();
  const pct = data.pctVsUsual;
  return (
    <p
      className="mt-1 text-xs text-muted"
      data-testid="dock-price-hint"
      title={t('title', { days: DOCK_PRICE_DAYS, count: data.samples })}
    >
      {t('usual', {
        price: formatIls(data.usualUnitPrice, { locale, maximumFractionDigits: 2 }),
        days: DOCK_PRICE_DAYS,
      })}
      {Math.abs(pct) >= MIN_SHOWN_PCT ? (
        <>
          {' · '}
          <bdi dir="ltr" className={`font-mono tabular-nums ${pct > 0 ? 'text-warn' : ''}`}>
            {pct > 0 ? '+' : ''}
            {formatPercent(pct, locale, 1)}
          </bdi>
        </>
      ) : null}
    </p>
  );
}
