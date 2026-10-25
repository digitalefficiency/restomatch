'use client';

import type { ReactNode } from 'react';
import { useLocale } from '@/lib/i18n/client';
import { formatIls } from '@/lib/money';
import { cn } from '../cn';
import { Skeleton } from '../Skeleton';
import { CellStateView, isCellState } from './cells';
import { deskCopy } from './copy';
import type { RowAction } from './DataTable';
import type { ColumnDef } from './types';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';

/**
 * A DataTable's phone form (below 768 px), from the same column defs:
 * line 1 is the identity and the first ₪ column (₪ at the line end, full
 * `formatIls` with the glyph since there is no header to carry it), line 2 the
 * remaining visible columns, then one action. No horizontal scroll at 390.
 */
export function MobileCardList<Row>({
  rows,
  columns,
  rowKey,
  status,
  onRetry,
  filtered,
  onClearFilters,
  emptyAction,
  rowActions,
  onOpen,
  caption,
}: {
  rows: readonly Row[];
  columns: ColumnDef<Row>[];
  rowKey: (row: Row) => string;
  status: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  rowActions?: (row: Row) => RowAction[];
  onOpen?: (row: Row) => void;
  caption: string;
}) {
  const locale = useLocale();
  const copy = deskCopy(locale);
  const identity = columns.find((c) => c.identity) ?? columns[0];
  const money = columns.find((c) => c.kind === 'money' && c.mobile !== 'hidden');
  const rest = columns.filter((c) => c !== identity && c !== money && c.mobile !== 'hidden');

  if (status === 'loading')
    return (
      <ul aria-hidden className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="rounded-xl border border-line bg-surface p-4">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="mt-2 h-3 w-1/2 rounded" />
          </li>
        ))}
      </ul>
    );
  if (status === 'error')
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <p role="alert" className="font-semibold text-ink">
          {copy.loadError}
        </p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className={cn('mt-3 h-12 rounded-lg bg-primary px-5 font-semibold text-on-primary', FOCUS)}>
            {copy.retry}
          </button>
        ) : null}
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface p-6 text-center">
        <p className="font-semibold text-ink">{filtered ? copy.noResults : copy.empty}</p>
        <div className="mt-3">
          {filtered && onClearFilters ? (
            <button type="button" onClick={onClearFilters} className={cn('h-12 rounded-lg border border-line-strong px-5 font-semibold text-ink', FOCUS)}>
              {copy.clearFilters}
            </button>
          ) : (
            emptyAction
          )}
        </div>
      </div>
    );

  const text = (c: ColumnDef<Row>, row: Row): ReactNode => {
    const custom = c.cell?.(row);
    if (custom !== undefined) return isCellState(custom) ? <CellStateView state={custom} /> : custom;
    const v = c.value?.(row);
    if (v == null || v === '') return <CellStateView state="na" />;
    if (c.kind === 'money' && typeof v === 'number')
      return <bdi>{formatIls(v / 100, { maximumFractionDigits: c.decimals ?? 2, locale })}</bdi>;
    return String(v);
  };

  return (
    <ul aria-label={caption} className="space-y-2" data-mobile-cards="">
      {rows.map((row) => {
        const action = rowActions?.(row)[0];
        return (
          <li key={rowKey(row)} data-row-id={rowKey(row)} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onOpen?.(row)}
                className={cn('min-w-0 flex-1 text-start text-base font-semibold text-ink', FOCUS)}
              >
                <span className="line-clamp-2 break-words">{identity ? text(identity, row) : rowKey(row)}</span>
              </button>
              {money ? <span className="shrink-0 text-base font-semibold tabular-nums text-ink">{text(money, row)}</span> : null}
            </div>
            {rest.length > 0 ? (
              <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
                {rest.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 ? <span aria-hidden>· </span> : null}
                    <span className="sr-only">{c.header}: </span>
                    {text(c, row)}
                  </span>
                ))}
              </p>
            ) : null}
            {action ? (
              <button
                type="button"
                onClick={action.onRun}
                className={cn(
                  'mt-3 h-12 w-full rounded-lg border text-base font-semibold',
                  FOCUS,
                  action.tone === 'danger' ? 'border-danger/40 text-danger' : 'border-primary/40 text-primary',
                )}
              >
                {action.label}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
