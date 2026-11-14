'use client';

import { Minus, Triangle, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { views } from '@/lib/i18n/messages/views';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { deltaView, type Compare } from './state';

/**
 * ▲/▼ change against the comparison period. For a leak, up is bad (ink words, the arrow in the
 * leak colour; DS3) and down is good (primary); `upIsGood` flips that for spend-like figures shown
 * neutrally. Renders nothing when compare is off or `previous` is undefined (not compared). With `thinBase` (isThinBase)
 * it shows only the calm ₪ difference — never a % or a red ▲ against a period
 * that has almost no data.
 */
export function DeltaBadge({
  current,
  previous,
  vs: vsLabel,
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
  /** null = compared, but there is no base (says so); undefined = not compared here (renders nothing). */
  previous: number | null | undefined;
  /** What it is compared with, e.g. "מול 1–25 בספט׳" (default: "vs the previous period"). */
  vs?: string;
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
  if (compare === 'off' || previous === undefined) return null;
  const vs = vsLabel ?? (compare === 'yoy' ? t('delta.yoy') : t('delta.prev'));
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
        {/* The sign sits OUTSIDE the isolate, in the text's own direction: a Hebrew reader meets it first (never "₪12+"). */}
        <span className="tabular-nums" data-delta-signed>
          {v.up ? '+' : '−'}
          <bdi>{abs(Math.abs(v.diff))}</bdi>
        </span>
        {bare ? null : <span className="font-normal text-subtle">{vs}</span>}
        <span className="font-normal text-subtle">· {t('delta.thinBase')}</span>
      </span>
    );
  }
  const flat = v.kind === 'flat';
  const up = v.kind === 'change' && v.up;
  const diff = v.kind === 'change' ? v.diff : 0;
  // DS3: colour by meaning, and a money figure is never red. Bad keeps its words in ink; only the
  // arrow and the drawn mark take the leak colour.
  const bad = !flat && !neutral && up !== upIsGood;
  const tone = flat || neutral ? 'text-muted' : bad ? 'text-fg' : 'text-primary';
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
      <Icon className={cn('h-3.5 w-3.5 shrink-0', bad && 'text-danger')} aria-hidden="true" />
      {/* G11: the ▲/▼ mark is drawn, never typed. No UI face (Heebo, Plex) has U+25B2/U+25BC,
          so a text glyph was painted by a system font. Never mirrored (R1). */}
      {flat ? null : (
        <Triangle
          data-delta-mark={up ? 'up' : 'down'}
          className={cn('h-2 w-2 shrink-0 fill-current', !up && 'rotate-180', bad && 'text-danger')}
          strokeWidth={0}
          aria-hidden="true"
        />
      )}
      <span>{text}</span>
      {showAmount && !flat && pct ? (
        <span className="tabular-nums" data-delta-signed>
          ({up ? '+' : '−'}
          <bdi>{abs(Math.abs(diff))}</bdi>)
        </span>
      ) : null}
      {bare ? null : <span className="font-normal text-subtle">{vs}</span>}
    </span>
  );
}
