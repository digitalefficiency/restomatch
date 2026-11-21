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
  current = 0,
  previous = 0,
  change,
  goodWhen = 'neutral',
  kind = 'ils',
  showPercent = false,
  flatBelow,
  about,
  className,
}: {
  current?: number;
  previous?: number;
  /**
   * A change the caller already computed, exact to the agora, with its own percent rule: `agorot` is
   * the signed change and `share` the signed share of the base, or `null` when the base is too thin to
   * quote a percent. When given, `current` / `previous` are not used and the amount is shekels
   * (DS3-03's home: "ירידה של ₪14 (2%) לעומת אותם ימים בספטמבר", with `about` for the tail).
   */
  change?: { agorot: number; share: number | null };
  goodWhen?: 'up' | 'down' | 'neutral';
  kind?: 'ils' | 'pct' | 'count';
  showPercent?: boolean;
  /**
   * A change smaller than this share of `previous` (0.02 = 2 %) reads "ללא שינוי מהותי" and takes
   * no colour. Off by default: the threshold is the screen's decision (the kit only proposes one).
   */
  flatBelow?: number;
  /** After the figures: what changed ("בדליפה") or against what ("לעומת אותם ימים בספטמבר"). */
  about?: string;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT(components);
  const diff = change ? change.agorot : current - previous;
  const abs = Math.abs(diff);
  const share = change ? (change.share === null ? null : Math.abs(change.share)) : previous !== 0 ? abs / Math.abs(previous) : null;
  // What the reader sees decides: a change shown as ₪0 (under half a shekel) is never "עלייה של ₪0" with a red arrow.
  const roundsToZero = change ? Math.round(abs / 100) === 0 : kind === 'ils' ? Math.round(abs) === 0 : false;
  const negligible = diff !== 0 && (roundsToZero || (flatBelow !== undefined && share !== null && share < flatBelow));
  const dir = diff === 0 || negligible ? 'same' : diff > 0 ? 'up' : 'down';
  const meaning = dir === 'same' || goodWhen === 'neutral' ? 'flat' : dir === goodWhen ? 'good' : 'bad';
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const pct = showPercent && share !== null ? formatPercent(share, locale) : null;

  return (
    <span
      data-delta={meaning}
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 text-body-sm',
        // SPEC kit "שינוי": good in the T3 green (the recovered role; SPEC §2 correction of 14.11: never the action
        // role), bad in ink with the arrow in the leak indicator, flat grey.
        meaning === 'good' ? 'font-medium text-gold' : meaning === 'bad' ? 'font-medium text-fg' : cn(TEXT_TONE.neutral, 'font-normal'),
        className,
      )}
    >
      {/* The arrow is a drawing in the leak indicator (DS3-00 generates the dot roles for strokes and fills, never text). */}
      <Icon className={cn('h-4 w-4 shrink-0', meaning === 'bad' && 'stroke-danger-dot')} aria-hidden="true" />
      {dir === 'same' ? (
        <span>
          {t(negligible ? 'ds.delta.negligible' : 'ds.delta.same')}
          {about ? ` ${about}` : null}
        </span>
      ) : (
        <span>
          {t(dir === 'up' ? 'ds.delta.upBy' : 'ds.delta.downBy')}{' '}
          {change ? (
            <Money agorot={abs} context="inline" />
          ) : kind === 'ils' ? (
            <Money value={abs} context="inline" />
          ) : (
            // Isolated, but not a money figure: `bdi.num` is the class <Money> gives an amount with ₪ (W1-01 reads it so).
            <bdi className="whitespace-nowrap">
              <span className="num">{kind === 'pct' ? formatPercent(abs / 100, locale) : formatNumber(abs, locale)}</span>
            </bdi>
          )}
          {/* The space stays outside the isolate, so in Hebrew it separates the percent from the amount. */}
          {pct ? (
            <>
              {' '}
              <bdi className="whitespace-nowrap">
                <span className="num">({pct})</span>
              </bdi>
            </>
          ) : null}
          {about ? ` ${about}` : null}
        </span>
      )}
    </span>
  );
}
