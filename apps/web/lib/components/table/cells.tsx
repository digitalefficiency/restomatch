'use client';

import { AlertTriangle, Clock } from 'lucide-react';
import { useLocale } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { deskCopy } from './copy';
import type { CellState } from './types';

/**
 * Number and money cells. Numbers align **physically right in both locales**
 * (RUBRIC R-1, B4) — `text-right` is the physical side in Tailwind 3, so a
 * logical-property sweep must never turn it into `text-end`. ₪ sits in the
 * column header ("סכום (₪)"), each column has one fixed precision, and the
 * exact ₪ (via `formatIls`) is in the `title` (B3d). The cell keeps the
 * page's direction, so a Hebrew screen reader reads it naturally.
 */

export const NUM_ALIGN = 'text-right tabular-nums lining-nums';

/** Fixed-decimal figure for a ₪ column whose ₪ is in the header. */
export function formatMoneyFigure(agorot: number, decimals: number, locale: Locale): string {
  return formatNumber(agorot / 100, locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The header label of a money column: "סכום (₪)". */
export function moneyHeader(header: string): string {
  return header.includes('₪') ? header : `${header} (₪)`;
}

export function isCellState(v: unknown): v is CellState {
  return v === 'na' || v === 'pending' || v === 'unavailable';
}

export function CellStateView({ state, onRetry }: { state: CellState; onRetry?: () => void }) {
  const copy = deskCopy(useLocale());
  if (state === 'na') return <span className="sr-only">{copy.na}</span>;
  if (state === 'pending')
    return (
      <span className="inline-flex items-center gap-1 text-muted">
        <Clock aria-hidden className="h-3.5 w-3.5" />
        {copy.pending}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-warn">
      <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
      {onRetry ? (
        <button type="button" onClick={onRetry} className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info">
          {copy.unavailable} · {copy.retry}
        </button>
      ) : (
        copy.unavailable
      )}
    </span>
  );
}

export interface NumCellProps {
  /** Integer agorot for money; a plain number otherwise. `null` → the `state` (default `na`). */
  value: number | null | undefined;
  kind?: 'money' | 'number';
  decimals?: number;
  state?: CellState;
  className?: string;
  onRetry?: () => void;
}

/** Inner content of a numeric cell (use inside any `<td>`/`<span>` that carries NUM_ALIGN). */
export function NumValue({ value, kind = 'money', decimals, state, onRetry }: Omit<NumCellProps, 'className'>) {
  const locale = useLocale();
  if (value == null) return <CellStateView state={state ?? 'na'} onRetry={onRetry} />;
  if (kind === 'money') {
    const d = decimals ?? 2;
    return (
      <span title={formatIls(value / 100, { maximumFractionDigits: 2, locale })}>
        {formatMoneyFigure(value, d, locale)}
      </span>
    );
  }
  const d = decimals ?? 0;
  return <span>{formatNumber(value, locale, { minimumFractionDigits: d, maximumFractionDigits: d })}</span>;
}

export function NumCell({ className, ...props }: NumCellProps) {
  return (
    <td className={cn(NUM_ALIGN, 'whitespace-nowrap px-[var(--cell-px,16px)]', className)}>
      <NumValue {...props} />
    </td>
  );
}
