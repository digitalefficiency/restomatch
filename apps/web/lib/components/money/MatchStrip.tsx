'use client';

import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { cnMerge as cn } from '../cn';
import { MONEY_QUIET, SURFACE_TONE, TEXT_TONE } from '../tone';
import { Money } from './Money';

export type MatchCell = 'ordered' | 'received' | 'billed';

/** The gap, written out: a quantity ("3 פחות") or a share of the expected price ("10% יותר"). */
export interface MatchGap {
  /** A quantity in the strip's unit, or a ratio for `pct` (0.1 = 10 %). Never signed: `direction` says which way. */
  value: number;
  kind: 'qty' | 'pct';
  direction: 'less' | 'more';
}

export interface MatchStripProps {
  /** Quantities in `unit`, or prices per `unit` (each price through <Money>). */
  kind?: 'qty' | 'price';
  /** `null` = not known ("אין"), never 0. */
  ordered: number | null;
  received: number | null;
  /** Leave out at the dock, where only ordered and received appear (SPEC §1.3). */
  billed?: number | null;
  /** The unit of the quantities ("ק״ג"), or what a price is per ("חבית"). */
  unit?: string;
  /** The cell that does not match: it is tinted and its figure is set heavier. */
  off?: MatchCell | null;
  /** The gap: structured (formatted here) or a node from the caller. Shown only with `off`. */
  gap?: MatchGap | React.ReactNode;
  /** `leak` for a gap that blocks or costs money; `warn` for a warning that waits for handling. */
  tone?: 'leak' | 'warn';
  /** The third column's name: "חויב" in the product, "בחשבונית" in a letter to a supplier. */
  billedLabel?: 'billed' | 'invoice';
  className?: string;
}

function isGap(g: unknown): g is MatchGap {
  return typeof g === 'object' && g !== null && 'value' in g && 'kind' in g && 'direction' in g;
}

/**
 * Ordered · received · billed in one line (DS3 kit "ההשוואה המשולשת, בשורה אחת"; SPEC §1.3).
 * The same comparison as the approvals desk, folded into a table row, a card or a phone: always
 * in this order, the cell that does not match tinted, and the gap written so nobody computes it.
 * The visible cells are one summary for a screen reader (`role="group"` + label).
 */
export function MatchStrip({
  kind = 'qty',
  ordered,
  received,
  billed,
  unit,
  off = null,
  gap,
  tone = 'leak',
  billedLabel = 'billed',
  className,
}: MatchStripProps) {
  const t = useT(components);
  const locale = useLocale();
  const qty = (n: number) => formatNumber(n, locale, { maximumFractionDigits: 3 });

  const cells: Array<{ key: MatchCell; label: string; value: number | null }> = [
    { key: 'ordered', label: t('ds.matchStrip.ordered'), value: ordered },
    { key: 'received', label: t('ds.matchStrip.received'), value: received },
  ];
  if (billed !== undefined) {
    cells.push({ key: 'billed', label: t(billedLabel === 'invoice' ? 'ds.matchStrip.invoice' : 'ds.matchStrip.billed'), value: billed });
  }

  const unitText = unit ? (kind === 'price' ? t('ds.matchStrip.perUnit', { unit }) : unit) : '';
  const gapNode: React.ReactNode = off
    ? isGap(gap)
      ? t(gap.direction === 'less' ? 'ds.matchStrip.less' : 'ds.matchStrip.more', {
          value: gap.kind === 'pct' ? formatPercent(Math.abs(gap.value), locale) : qty(Math.abs(gap.value)),
        })
      : gap ?? null
    : null;

  // One sentence for assistive tech: "הוזמן 9.5, התקבל 6.5, חויב 9.5 ק״ג, 3 פחות".
  const plain = (n: number | null) => (n === null ? t('ds.matchStrip.none') : kind === 'price' ? null : qty(n));
  const spoken = cells.every((c) => plain(c.value) !== null)
    ? [
        cells.map((c) => `${c.label} ${plain(c.value)}`).join(', ') + (unitText ? ` ${unitText}` : ''),
        typeof gapNode === 'string' ? gapNode : '',
      ]
        .filter(Boolean)
        .join(', ')
    : undefined;

  return (
    <div
      role="group"
      aria-label={spoken}
      data-match-strip=""
      data-off={off ?? undefined}
      className={cn('num flex max-w-full items-stretch overflow-hidden rounded-control border border-line-rule bg-surface', className)}
    >
      {cells.map((c, i) => {
        const isOff = off === c.key;
        return (
          <span
            key={c.key}
            data-cell={c.key}
            aria-hidden={spoken ? true : undefined}
            className={cn(
              'flex min-w-0 flex-col justify-center px-3 py-1.5',
              i > 0 && 'border-s border-line-rule',
              isOff && cn('border', SURFACE_TONE[tone], '[&+*]:border-s-transparent'),
            )}
          >
            <small className="text-caption text-fg-tertiary">{c.label}</small>
            {c.value === null ? (
              <b className={cn('text-body font-normal leading-5', MONEY_QUIET)}>{t('ds.matchStrip.none')}</b>
            ) : kind === 'price' ? (
              <b className={cn('text-body leading-5', isOff ? 'font-semibold' : 'font-medium')}>
                <Money value={c.value} context="line" />
              </b>
            ) : (
              <b className={cn('text-body leading-5', isOff ? 'font-semibold' : 'font-medium')}>
                <bdi>{qty(c.value)}</bdi>
              </b>
            )}
          </span>
        );
      })}
      {unitText ? (
        <span aria-hidden={spoken ? true : undefined} className="flex items-center whitespace-nowrap border-s border-line-rule pe-1 ps-2.5 text-body-sm text-fg-secondary">
          {unitText}
        </span>
      ) : null}
      {gapNode ? (
        <span
          aria-hidden={spoken ? true : undefined}
          data-gap=""
          className={cn('me-2.5 ms-auto self-center whitespace-nowrap ps-2 text-body-sm font-semibold', TEXT_TONE[tone])}
        >
          {gapNode}
        </span>
      ) : null}
    </div>
  );
}
