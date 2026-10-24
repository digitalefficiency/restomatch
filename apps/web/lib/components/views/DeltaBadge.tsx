'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { views } from '@/lib/i18n/messages/views';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { deltaView, type Compare } from './state';

/**
 * ▲/▼ change against the comparison period. For a leak, up is bad (danger) and
 * down is good (primary); `upIsGood` flips that for spend-like figures shown
 * neutrally. Renders nothing when compare is off. With `thinBase` (isThinBase)
 * it shows only the calm ₪ difference — never a % or a red ▲ against a period
 * that has almost no data.
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
  thinBase = false,
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
  /** The comparison period is too thin to compare (isThinBase). */
  thinBase?: boolean;
  className?: string;
}) {
  const t = useT(views);
  const locale = useLocale();
  if (compare === 'off') return null;
  const vs = compare === 'yoy' ? t('delta.yoy') : t('delta.prev');
  const v = deltaView(current, previous, { thinBase, kind });
  if (v.kind === 'none') {
    // In a table cell (bare) a quiet dash; standalone, say why there is no change.
    if (bare) return <span className={cn('text-xs text-subtle', className)}>—</span>;
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-subtle', className)}>
        {t('delta.noBase')}
      </span>
    );
  }
  const abs = (n: number) =>
    kind === 'ratio' ? formatPercent(n, locale, 1) : kind === 'count' ? formatNumber(n, locale) : formatIls(n, { locale });
  if (v.kind === 'thin') {
    return (
      <span
        className={cn('inline-flex flex-wrap items-center gap-1 text-xs font-semibold text-muted', className)}
        title={t('delta.thinBase')}
        data-delta="thin"
      >
        <span className="font-mono tabular-nums" dir="ltr">
          {v.up ? '+' : '−'}
          {abs(Math.abs(v.diff))}
        </span>
        {bare ? null : <span className="font-normal text-subtle">{vs}</span>}
        <span className="font-normal text-subtle">· {t('delta.thinBase')}</span>
      </span>
    );
  }
  const flat = v.kind === 'flat';
  const up = v.kind === 'change' && v.up;
  const diff = v.kind === 'change' ? v.diff : 0;
  const tone = flat || neutral ? 'text-muted' : up === upIsGood ? 'text-primary' : 'text-danger';
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const pct = v.kind === 'change' && v.pct != null ? formatPercent(Math.abs(v.pct), locale, 1) : null;
  const text = flat
    ? t('delta.flat')
    : pct
      ? t(up ? 'delta.up' : 'delta.down', { pct })
      : `${up ? '+' : '−'}${abs(Math.abs(diff))}`;
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
          {abs(Math.abs(diff))})
        </span>
      ) : null}
      {bare ? null : <span className="font-normal text-subtle">{vs}</span>}
    </span>
  );
}
