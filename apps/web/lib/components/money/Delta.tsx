'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { TEXT_TONE } from '../tone';
import { Money } from './Money';

/**
 * A change against a previous period (DS3 kit "שינוי מול תקופה קודמת"): an arrow, a word, the
 * ABSOLUTE amount and, optionally, the percent — "ירידה של ₪14 (2%)". No hand-built "+"/"−": the
 * direction is the arrow and the word (design-system-24). Colour comes from meaning (`goodWhen`),
 * never from the sign: a good change is green, a bad one keeps its words and amount in ink and
 * only its arrow takes the leak colour (a money figure is never red), a negligible one is grey.
 */
export function Delta({
  current,
  previous,
  goodWhen = 'neutral',
  kind = 'ils',
  showPercent = false,
  flatBelow,
  about,
  className,
}: {
  current: number;
  previous: number;
  goodWhen?: 'up' | 'down' | 'neutral';
  kind?: 'ils' | 'pct' | 'count';
  showPercent?: boolean;
  /**
   * A change smaller than this share of `previous` (0.02 = 2 %) reads "ללא שינוי מהותי" and takes
   * no colour. Off by default: the threshold is the screen's decision (the kit only proposes one).
   */
  flatBelow?: number;
  /** What changed, after the figures: "בדליפה", "בזיכויים שחזרו". */
  about?: string;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT(components);
  const diff = current - previous;
  const abs = Math.abs(diff);
  const share = previous !== 0 ? abs / Math.abs(previous) : null;
  const negligible = diff !== 0 && flatBelow !== undefined && share !== null && share < flatBelow;
  const dir = diff === 0 || negligible ? 'same' : diff > 0 ? 'up' : 'down';
  const meaning = dir === 'same' || goodWhen === 'neutral' ? 'flat' : dir === goodWhen ? 'good' : 'bad';
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const pct = showPercent && share !== null ? formatPercent(share, locale) : null;

  return (
    <span
      data-delta={meaning}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 text-body-sm',
        // SPEC kit "שינוי": good in the brand green, bad in ink with the arrow in the leak indicator, flat grey.
        meaning === 'good' ? 'font-medium text-primary' : meaning === 'bad' ? 'font-medium text-fg' : cn(TEXT_TONE.neutral, 'font-normal'),
        className,
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', meaning === 'bad' && 'text-danger-dot')} aria-hidden="true" />
      {dir === 'same' ? (
        <span>{t(negligible ? 'ds.delta.negligible' : 'ds.delta.same')}</span>
      ) : (
        <span>
          {t(dir === 'up' ? 'ds.delta.upBy' : 'ds.delta.downBy')}{' '}
          {kind === 'ils' ? (
            <Money value={abs} context="inline" />
          ) : (
            <bdi className="num whitespace-nowrap">{kind === 'pct' ? formatPercent(abs / 100, locale) : formatNumber(abs, locale)}</bdi>
          )}
          {pct ? <bdi className="num whitespace-nowrap"> ({pct})</bdi> : null}
          {about ? ` ${about}` : null}
        </span>
      )}
    </span>
  );
}
