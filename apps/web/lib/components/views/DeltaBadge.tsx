'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { views } from '@/lib/i18n/messages/views';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { delta, type Compare } from './state';

/**
 * ▲/▼ change against the comparison period. For a leak, up is bad (danger) and
 * down is good (primary); `upIsGood` flips that for spend-like figures shown
 * neutrally. Renders nothing when compare is off.
 */
export function DeltaBadge({
  current,
  previous,
  compare,
  upIsGood = false,
  neutral = false,
  showAmount = false,
  bare = false,
  kind = 'ils',
  className,
}: {
  current: number;
  previous: number | null | undefined;
  compare: Compare;
  upIsGood?: boolean;
  /** Spend-like figure: show the change without a good/bad colour. */
  neutral?: boolean;
  /** Also show the ₪ difference. */
  showAmount?: boolean;
  /** Omit the "vs previous period" suffix (e.g. inside a table column). */
  bare?: boolean;
  /** What the numbers are: ₪ (default), a ratio (leak %) or a count. */
  kind?: 'ils' | 'ratio' | 'count';
  className?: string;
}) {
  const t = useT(views);
  const locale = useLocale();
  if (compare === 'off') return null;
  const vs = compare === 'yoy' ? t('delta.yoy') : t('delta.prev');
  const d = delta(current, previous);
  if (!d || (d.pct == null && d.diff === 0)) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-subtle', className)}>
        {t('delta.noBase')}
      </span>
    );
  }
  const flat = Math.abs(d.diff) < (kind === 'ratio' ? 0.00005 : 0.005);
  const abs = (v: number) =>
    kind === 'ratio' ? formatPercent(v, locale, 1) : kind === 'count' ? formatNumber(v, locale) : formatIls(v, { locale });
  const up = d.diff > 0;
  const tone = flat || neutral ? 'text-muted' : up === upIsGood ? 'text-primary' : 'text-danger';
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const pct = d.pct == null ? null : formatPercent(Math.abs(d.pct), locale, 1);
  const text = flat
    ? t('delta.flat')
    : pct
      ? t(up ? 'delta.up' : 'delta.down', { pct })
      : `${up ? '+' : '−'}${abs(Math.abs(d.diff))}`;
  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1 text-xs font-semibold', tone, className)}
      title={vs}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span aria-hidden="true">{flat ? '' : up ? '▲' : '▼'}</span>
      <span>{text}</span>
      {showAmount && !flat && pct ? (
        <span className="font-mono tabular-nums" dir="ltr">
          ({up ? '+' : '−'}
          {abs(Math.abs(d.diff))})
        </span>
      ) : null}
      {bare ? null : <span className="font-normal text-subtle">{vs}</span>}
    </span>
  );
}
