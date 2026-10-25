'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';
import { moneyText } from './format';

/**
 * A change between two values: arrow + word (עלייה / ירידה) + the ABSOLUTE
 * amount, plus an optional %. No hand-built "+"/"−" sign (design-system-24):
 * the direction is the arrow and the word. Colour comes from meaning
 * (`goodWhen`), never from the sign.
 */
export function Delta({
  current,
  previous,
  goodWhen = 'neutral',
  kind = 'ils',
  showPercent = false,
  className,
}: {
  current: number;
  previous: number;
  goodWhen?: 'up' | 'down' | 'neutral';
  kind?: 'ils' | 'pct' | 'count';
  showPercent?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const t = useT(components);
  const diff = current - previous;
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const tone =
    dir === 'same' || goodWhen === 'neutral' ? 'text-muted' : dir === goodWhen ? 'text-primary' : 'text-danger';
  const abs = Math.abs(diff);
  const amount =
    kind === 'ils' ? moneyText(abs, 'inline', locale) : kind === 'pct' ? formatPercent(abs / 100, locale) : formatNumber(abs, locale);
  const pct = showPercent && previous !== 0 ? formatPercent(abs / Math.abs(previous), locale) : null;
  const Icon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus;

  return (
    <span className={cn('inline-flex items-center gap-1 text-caption font-semibold', tone, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t(`ds.delta.${dir}`)}</span>
      {dir === 'same' ? null : (
        <bdi className="num whitespace-nowrap">
          {amount}
          {pct ? ` · ${pct}` : ''}
        </bdi>
      )}
    </span>
  );
}
