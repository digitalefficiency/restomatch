'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { moneyText, type MoneyContext } from './format';

/**
 * A price change, read in the language's direction (R-4): old ← new in Hebrew,
 * old → new in English. The arrow is decorative; the sentence is in sr-only text.
 */
export function PriceMove({
  from,
  to,
  basis,
  context = 'line',
  className,
}: {
  from: number;
  to: number;
  /** Unit basis, e.g. "לק״ג". */
  basis?: string;
  context?: MoneyContext;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT(components);
  const a = moneyText(from, context, locale);
  const b = moneyText(to, context, locale);
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-1', className)}>
      <span className="sr-only">{t('ds.priceMove.label', { from: a, to: b })}</span>
      <span aria-hidden="true" className="inline-flex items-baseline gap-1">
        <bdi className="num whitespace-nowrap text-muted line-through decoration-1">{a}</bdi>
        <span>{locale === 'he' ? '←' : '→'}</span>
        <bdi className="num whitespace-nowrap font-semibold text-ink">{b}</bdi>
        {basis ? <span className="text-muted">{basis}</span> : null}
      </span>
    </span>
  );
}
