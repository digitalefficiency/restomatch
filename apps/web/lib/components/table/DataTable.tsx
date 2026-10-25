'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Lock, MoreHorizontal } from 'lucide-react';
import { useLocale } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { cn } from '../cn';
import { Skeleton } from '../Skeleton';
import { Peek } from '../desk/Peek';
import { deskKeyOf, moveIndex } from '../desk/keys';
import { useMediaQuery } from '../desk/useMediaQuery';
import { BatchBar } from './BatchBar';
import { CellStateView, NUM_ALIGN, NumValue, isCellState, moneyHeader } from './cells';
import { deskCopy } from './copy';
import { buildExportCsv, downloadText, exportTable, type ExportMeta } from './exportCsv';
import { ColumnsMenu, DensityMenu, ExportMenu } from './menus';
import { MobileCardList } from './MobileCardList';
import { pageWindow } from './paging';
import { ToolbarPopover } from './Popover';
import { DEFAULT_BULK_CAP_AGOROT, disabledReason, isOverCap, selectAllIds, summarize, toggleId } from './selection';
import { ariaSortOf, nextSort, sortRows } from './sort';
import type { BatchAction, ColumnDef, Density, Selectability, SortSpec, TableTotals } from './types';
import { useScrollMemory, useTableUrlState } from './useTableUrlState';

export interface RowAction {
  id: string;
  label: string;
  onRun: () => void;
  tone?: 'default' | 'danger';
}

export interface DataTableProps<Row> {
  /** Namespace for scroll memory and the export file name. */
  id: string;
  /** Accessible table caption (visually hidden). */
  caption: string;
  /** Every row of the current view; the table sorts and pages them. */
  rows: readonly Row[];
  columns: ColumnDef<Row>[];
  rowKey: (row: Row) => string;
  defaultSort: SortSpec;
  /** Server-computed totals (count + Σ agorot); the totals row shows these, never a page sum. */
  totals?: TableTotals & { columnId: string };
  pageSize?: number;
  density?: Density;
  status?: 'ready' | 'loading' | 'error';
  onRetry?: () => void;
  /** Filters are active: the empty state offers to clear them. */
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  // Batch mode
  selectable?: (row: Row) => Selectability;
  amountAgorot?: (row: Row) => number;
  /** Per-item bulk cap in agorot; `null` turns it off. Default ₪200 (R-12). */
  capAgorot?: number | null;
  batchActions?: BatchAction<Row>[];
  // Row affordances
  rowActions?: (row: Row) => RowAction[];
  rowTone?: (row: Row) => 'danger' | 'warn' | undefined;
  onOpen?: (row: Row) => void;
  peek?: { title: (row: Row) => ReactNode; render: (row: Row) => ReactNode; href?: (row: Row) => string };
  /** Toolbar content before the menus (view tabs, search, filters). */
  toolbar?: ReactNode;
  exportMeta?: Omit<ExportMeta, 'generatedAt'>;
  className?: string;
}

const ROW_H: Record<Density, string> = {
  compact: 'h-[var(--row-compact,32px)]',
  default: 'h-[var(--row-default,48px)]',
  touch: 'h-[var(--row-touch,56px)]',
};
// A coarse pointer never gets rows below the touch height (B6), whatever the density.
const COARSE = '[@media(pointer:coarse)]:h-[var(--row-touch,56px)]';
const CELL_PX: Record<Density, string> = { compact: '[--cell-px:12px]', default: '[--cell-px:16px]', touch: '[--cell-px:16px]' };
const SELECT_W = 'w-10 min-w-10';
// Row rail on the inline-start edge: 3 px tone for T2 queue rows, 2 px for the active/selected row.
const RAIL = {
  danger: 'ltr:shadow-[inset_3px_0_0_rgb(var(--c-danger))] rtl:shadow-[inset_-3px_0_0_rgb(var(--c-danger))]',
  warn: 'ltr:shadow-[inset_3px_0_0_rgb(var(--c-warn))] rtl:shadow-[inset_-3px_0_0_rgb(var(--c-warn))]',
  selected: 'ltr:shadow-[inset_2px_0_0_rgb(var(--c-primary))] rtl:shadow-[inset_-2px_0_0_rgb(var(--c-primary))]',
  none: undefined,
} as const;
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-info';

/**
 * The desk list primitive (lens-exec-desktop §3.5, design-system §4.6). Headless
 * by design — no table dependency — and URL-driven through `useTableUrlState`:
 * sort, visible columns, the active row (`sel`), the peeked row (`peek`), page
 * and density are all shareable and survive Back.
 *
 * - Exactly one `th[aria-sort]`; ₪ and numeric columns sort descending first.
 * - Sticky header, sticky identity column (inline-start) and sticky actions (inline-end).
 * - Numbers are physically right-aligned in he and en with ₪ in the header (R-1).
 * - Batch mode: `block` rows are disabled with a visible reason; select-all skips rows
 *   above the cap; the bar shows count + Σ₪ (R-12). Actions get eligible rows only.
 * - J/K/↓/↑ (by `KeyboardEvent.code`), Space peek, X select, Enter open, Esc clear —
 *   only while focus is inside the table body.
 * - Below 768 px the same columns render as a MobileCardList.
 */
export function DataTable<Row>(props: DataTableProps<Row>) {
  const {
    id,
    caption,
    rows,
    columns,
    rowKey,
    defaultSort,
    totals,
    pageSize = 50,
    density: densityProp = 'default',
    status = 'ready',
    onRetry,
    filtered,
    onClearFilters,
    emptyAction,
    selectable,
    amountAgorot,
    capAgorot = DEFAULT_BULK_CAP_AGOROT,
    batchActions,
    rowActions,
    rowTone,
    onOpen,
    peek,
    toolbar,
    exportMeta,
    className,
  } = props;
  const locale = useLocale();
  const copy = deskCopy(locale);
  const [state, update] = useTableUrlState();
  const mobile = useMediaQuery('(max-width: 767px)', false);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const captionId = useId();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const sort = state.sort && columns.some((c) => c.id === state.sort!.id && c.sortable !== false) ? state.sort : defaultSort;
  const density = state.density ?? densityProp;
  const visibleIds = state.cols ?? columns.filter((c) => !c.defaultHidden).map((c) => c.id);
  const visibleKey = visibleIds.join(',');
  const visible = useMemo(
    () => columns.filter((c) => c.identity || visibleKey.split(',').includes(c.id)),
    [columns, visibleKey],
  );

  const sorted = useMemo(() => sortRows(rows, columns, sort, locale), [rows, columns, sort, locale]);
  const win = pageWindow(sorted.length, state.page, pageSize);
  const pageRows = useMemo(() => sorted.slice(win.start, win.end), [sorted, win.start, win.end]);
  const rules = useMemo(
    () => ({ rowKey, selectable, amountAgorot, capAgorot }),
    [rowKey, selectable, amountAgorot, capAgorot],
  );
  const summary = summarize(rules, rows, selected);
  const batchMode = summary.count > 0;
  const activeIndex = state.sel ? pageRows.findIndex((r) => rowKey(r) === state.sel) : -1;
  const peekRow = peek && state.peek ? rows.find((r) => rowKey(r) === state.peek) : undefined;

  useScrollMemory(scroller, id, status === 'ready' && !mobile);

  // Drop selections that left the data (a view change, a refetch).
  useEffect(() => {
    setSelected((s) => {
      if (s.size === 0) return s;
      const ids = new Set(rows.map(rowKey));
      const next = new Set([...s].filter((x) => ids.has(x)));
      return next.size === s.size ? s : next;
    });
  }, [rows, rowKey]);

  const rowEl = useCallback(
    (rid: string) => body.current?.querySelector<HTMLElement>(`tr[data-row-id="${CSS.escape(rid)}"]`) ?? null,
    [],
  );

  const toggle = (rid: string) => setSelected((s) => toggleId(s, rid));
  const eligibleOnPage = selectAllIds(rules, pageRows);
  const allOnPage = eligibleOnPage.length > 0 && eligibleOnPage.every((x) => selected.has(x));
  const someOnPage = eligibleOnPage.some((x) => selected.has(x));

  const runBatch = async (a: BatchAction<Row>) => {
    setBusy(true);
    try {
      await a.run(summary.actionable);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const cols = visible;
    const t = totals
      ? { label: copy.totals(totals.count), columnId: totals.columnId, sumAgorot: totals.sumAgorot }
      : undefined;
    const out = exportTable(cols, sorted, t);
    const meta: ExportMeta = {
      title: exportMeta?.title ?? caption,
      period: exportMeta?.period ?? copy.exportMeta.none,
      scope: exportMeta?.scope ?? copy.exportMeta.none,
      filters: exportMeta?.filters || copy.exportMeta.none,
      generatedAt: new Date(),
    };
    const csv = buildExportCsv(meta, copy.exportMeta, out.columns, out.rows, out.totals);
    downloadText(`${id}-${formatDate(new Date(), 'en', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')}.csv`, csv);
  };

  const onBodyKeyDown = (e: React.KeyboardEvent) => {
    const k = deskKeyOf(e);
    if (!k) return;
    const fromRow = (e.target as HTMLElement).closest<HTMLElement>('tr[data-row-id]');
    const current = fromRow ? Number(fromRow.dataset.index) : activeIndex;
    const row = pageRows[current];
    if (k === 'next' || k === 'prev') {
      e.preventDefault();
      const i = moveIndex(current, k === 'next' ? 1 : -1, pageRows.length);
      const next = pageRows[i];
      if (!next) return;
      const rid = rowKey(next);
      update({ sel: rid, ...(state.peek ? { peek: rid } : {}) });
      rowEl(rid)?.focus();
      return;
    }
    if (!row) return;
    const rid = rowKey(row);
    if (k === 'peek' && peek) {
      // Space on a checkbox keeps its native toggle.
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault();
      update({ sel: rid, peek: state.peek === rid ? null : rid });
    } else if (k === 'select' && selectable) {
      e.preventDefault();
      if (disabledReason(rules, row) == null) toggle(rid);
    } else if (k === 'open' || k === 'openTab') {
      if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'A') return;
      e.preventDefault();
      const href = peek?.href?.(row);
      if (k === 'openTab' && href) window.open(href, '_blank', 'noopener');
      else if (onOpen) onOpen(row);
      else if (peek) update({ sel: rid, peek: rid });
    } else if (k === 'escape') {
      if (selected.size > 0) {
        e.preventDefault();
        setSelected(new Set());
      } else if (state.sel) {
        e.preventDefault();
        update({ sel: null });
      }
    }
  };

  const headerCell = (c: ColumnDef<Row>) => {
    const sortable = c.sortable !== false && !!c.value;
    const aria = ariaSortOf(sort, c.id);
    const label = c.kind === 'money' ? moneyHeader(c.header) : c.header;
    const num = c.kind === 'money' || c.kind === 'number';
    const Arrow = aria === 'descending' ? ArrowDown : aria === 'ascending' ? ArrowUp : ChevronsUpDown;
    return (
      <th
        key={c.id}
        scope="col"
        aria-sort={aria}
        data-col={c.id}
        className={cn(
          'sticky top-0 z-20 whitespace-nowrap border-b border-line bg-surface px-[var(--cell-px,16px)] text-xs font-semibold text-muted',
          num ? 'text-right' : 'text-start',
          c.identity && cn('z-30 start-0', selectable && 'start-10'),
          c.width,
        )}
      >
        {sortable ? (
          <button
            type="button"
            onClick={() => update({ sort: nextSort(sort, c), page: state.page > 1 ? 1 : state.page })}
            className={cn('inline-flex items-center gap-1 rounded hover:text-ink', FOCUS, num && 'flex-row-reverse', aria && 'text-ink')}
            title={copy.sortBy(c.header)}
          >
            {label}
            <Arrow aria-hidden className={cn('h-3.5 w-3.5', !aria && 'opacity-40')} />
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  const bodyCell = (c: ColumnDef<Row>, row: Row, rail?: string) => {
    const num = c.kind === 'money' || c.kind === 'number';
    const custom = c.cell?.(row);
    if (num && custom === undefined) {
      const v = c.value?.(row);
      return (
        <td key={c.id} className={cn(NUM_ALIGN, 'whitespace-nowrap px-[var(--cell-px,16px)]', c.width, rail)}>
          <NumValue value={typeof v === 'number' ? v : null} kind={c.kind === 'money' ? 'money' : 'number'} decimals={c.decimals} onRetry={onRetry} />
        </td>
      );
    }
    const content = custom === undefined ? String(c.value?.(row) ?? '') : custom;
    const reason = c.identity && selectable ? disabledReason(rules, row) : null;
    return (
      <td
        key={c.id}
        className={cn(
          'px-[var(--cell-px,16px)]',
          num && NUM_ALIGN,
          c.identity
            ? cn('sticky z-10 start-0 min-w-[200px] max-w-[320px] bg-inherit', selectable && 'start-10')
            : 'whitespace-nowrap',
          c.width,
          rail,
        )}
      >
        {isCellState(content) ? (
          <CellStateView state={content} onRetry={onRetry} />
        ) : c.identity ? (
          <div className="flex flex-wrap items-center gap-x-2">
            {/* Wraps to 2 lines before it truncates; a compact row has room for one. */}
            <span
              className={cn('break-words font-medium text-ink', density === 'compact' ? 'line-clamp-1' : 'line-clamp-2')}
              title={typeof content === 'string' ? content : undefined}
            >
              {content}
            </span>
            {reason ? (
              <span id={`${captionId}-why-${rowKey(row)}`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-danger">
                <Lock aria-hidden className="h-3 w-3" />
                {reason}
              </span>
            ) : null}
          </div>
        ) : (
          content
        )}
      </td>
    );
  };

  const colCount = visible.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  const toolbarRow = batchMode ? (
    <BatchBar
      count={summary.count}
      sumAgorot={amountAgorot ? summary.sumAgorot : undefined}
      overCapCount={summary.overCap.length}
      capAgorot={capAgorot}
      onClear={() => setSelected(new Set())}
      actions={(batchActions ?? []).map((a) => ({
        id: a.id,
        primary: a.primary,
        disabled: busy || summary.actionable.length === 0,
        label: a.label(summary.actionable.length, summary.sumAgorot),
        onRun: () => void runBatch(a),
      }))}
    />
  ) : (
    <div className="flex min-h-10 flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">{toolbar}</div>
      {!mobile ? (
        <div className="flex items-center gap-2 pb-1">
          <DensityMenu value={density} onChange={(d) => update({ density: d === densityProp ? null : d })} />
          <ColumnsMenu columns={columns} visible={visibleIds} onChange={(cols) => update({ cols })} />
          <ExportMenu onCsv={exportCsv} />
        </div>
      ) : null}
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted">
      <p data-table-showing>{copy.showing(win.from, win.to, sorted.length)}</p>
      {win.pages > 1 ? (
        <nav aria-label={copy.pager} className="flex items-center gap-1">
          <button
            type="button"
            disabled={win.page <= 1}
            onClick={() => update({ page: win.page - 1 })}
            className={cn('h-8 rounded-lg border border-line-strong px-3 text-ink disabled:opacity-40', FOCUS)}
          >
            {copy.prev}
          </button>
          <span className="px-2 tabular-nums">
            {win.page}/{win.pages}
          </span>
          <button
            type="button"
            disabled={win.page >= win.pages}
            onClick={() => update({ page: win.page + 1 })}
            className={cn('h-8 rounded-lg border border-line-strong px-3 text-ink disabled:opacity-40', FOCUS)}
          >
            {copy.next}
          </button>
        </nav>
      ) : null}
    </div>
  );

  const peekPanel = peek ? (
    <Peek
      open={!!peekRow}
      title={peekRow ? peek.title(peekRow) : ''}
      fullHref={peekRow ? peek.href?.(peekRow) : undefined}
      onClose={() => update({ peek: null })}
      returnFocus={() => (state.peek ? rowEl(state.peek) : null)}
    >
      {peekRow ? peek.render(peekRow) : null}
    </Peek>
  ) : null;

  const hasPeek = !!peek;
  // Rows re-render only when what they show changes — opening or closing a Peek
  // does not touch them, so the panel paints in one frame (D6).
  const dataRows = useMemo(
    () =>
      pageRows.map((row, i) => {
        const rid = rowKey(row);
        const reason = selectable ? disabledReason(rules, row) : null;
        const checked = selected.has(rid);
        const active = rid === state.sel;
        const rail = RAIL[rowTone?.(row) ?? (checked || active ? 'selected' : 'none')];
        const actions = rowActions?.(row) ?? [];
        const label = String(columns.find((c) => c.identity)?.value?.(row) ?? rid);
        return (
          <tr
            key={rid}
            data-row-id={rid}
            data-index={i}
            data-selected={checked || undefined}
            data-active={active || undefined}
            data-block={reason ? '' : undefined}
            data-over-cap={selectable && isOverCap(rules, row) ? '' : undefined}
            tabIndex={active || (activeIndex < 0 && i === 0) ? 0 : -1}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button,a,input,label')) return;
              update({ sel: rid, ...(peek ? { peek: rid } : {}) });
            }}
            className={cn(
              'group relative bg-surface text-sm [&>td]:py-0 [&>td]:border-b [&>td]:border-line [&:last-child>td]:border-b-0',
              ROW_H[density],
              COARSE,
              FOCUS,
              checked || active ? 'bg-surface-2' : 'hover:bg-surface-2',
            )}
          >
            {selectable ? (
              <td className={cn('sticky start-0 z-10 bg-inherit px-0 text-center', SELECT_W, rail)}>
                <label className="inline-flex h-7 w-10 cursor-pointer items-center justify-center [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!!reason}
                    onChange={() => toggle(rid)}
                    aria-label={copy.selectRow(label)}
                    aria-describedby={reason ? `${captionId}-why-${rid}` : undefined}
                    className="h-4 w-4 accent-primary disabled:cursor-not-allowed"
                  />
                </label>
              </td>
            ) : null}
            {visible.map((c, ci) => bodyCell(c, row, !selectable && ci === 0 ? rail : undefined))}
            {rowActions ? (
              <td className="sticky end-0 z-10 w-px whitespace-nowrap bg-inherit px-2">
                <div className={cn('flex items-center justify-end gap-1', 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100', active && 'opacity-100')}>
                  {actions.slice(0, 2).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={batchMode}
                      onClick={a.onRun}
                      className={cn(
                        'h-7 rounded-lg px-2.5 text-sm font-semibold disabled:opacity-40 [@media(pointer:coarse)]:h-11',
                        FOCUS,
                        a.tone === 'danger' ? 'text-danger hover:bg-danger/[0.08]' : 'text-primary hover:bg-primary/[0.08]',
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                  {actions.length > 2 ? (
                    <ToolbarPopover label={copy.more} iconOnly disabled={batchMode} icon={<MoreHorizontal aria-hidden className="h-4 w-4" />}>
                      {(close) => (
                        <ul>
                          {actions.slice(2).map((a) => (
                            <li key={a.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  close();
                                  a.onRun();
                                }}
                                className={cn('w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-surface-2', FOCUS, a.tone === 'danger' ? 'text-danger' : 'text-ink')}
                              >
                                {a.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </ToolbarPopover>
                  ) : null}
                </div>
              </td>
            ) : null}
          </tr>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `peek` content and the row helpers are derived from these
    [pageRows, visible, density, selected, state.sel, batchMode, rules, rowActions, rowTone, columns, captionId, onRetry, activeIndex, hasPeek],
  );

  if (mobile) {
    return (
      <div className={cn('space-y-3', className)} data-table={id}>
        {toolbarRow}
        <MobileCardList
          rows={pageRows}
          columns={visible}
          rowKey={rowKey}
          status={status}
          onRetry={onRetry}
          filtered={filtered}
          onClearFilters={onClearFilters}
          emptyAction={emptyAction}
          rowActions={rowActions}
          onOpen={(r) => (onOpen ? onOpen(r) : peek ? update({ sel: rowKey(r), peek: rowKey(r) }) : undefined)}
          caption={caption}
        />
        {status === 'ready' && sorted.length > 0 ? footer : null}
        {peekPanel}
      </div>
    );
  }

  let bodyRows: ReactNode;
  if (status === 'loading') {
    bodyRows = Array.from({ length: 8 }, (_, i) => (
      <tr key={i} className={cn(ROW_H[density], COARSE, '[&>td]:border-b [&>td]:border-line')} aria-hidden>
        {Array.from({ length: colCount }, (_, j) => (
          <td key={j} className="px-[var(--cell-px,16px)]">
            <Skeleton className="h-3 w-full max-w-32 rounded" />
          </td>
        ))}
      </tr>
    ));
  } else if (status === 'error') {
    bodyRows = (
      <tr>
        <td colSpan={colCount} className="px-4 py-10 text-center">
          <p className="font-semibold text-ink" role="alert">
            {copy.loadError}
          </p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={cn('mt-3 h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary', FOCUS)}>
              {copy.retry}
            </button>
          ) : null}
        </td>
      </tr>
    );
  } else if (pageRows.length === 0) {
    bodyRows = (
      <tr>
        <td colSpan={colCount} className="px-4 py-10 text-center">
          <p className="font-semibold text-ink">{filtered ? copy.noResults : copy.empty}</p>
          <div className="mt-3">
            {filtered && onClearFilters ? (
              <button type="button" onClick={onClearFilters} className={cn('h-10 rounded-lg border border-line-strong px-4 text-sm font-semibold text-ink', FOCUS)}>
                {copy.clearFilters}
              </button>
            ) : (
              emptyAction
            )}
          </div>
        </td>
      </tr>
    );
  } else {
    bodyRows = dataRows;
  }

  const totalsCol = totals ? visible.find((c) => c.id === totals.columnId) : undefined;

  return (
    <div className={cn('space-y-3', className)} data-table={id}>
      {toolbarRow}
      <div
        ref={scroller}
        className="max-h-[min(72dvh,900px)] overflow-auto rounded-xl border border-line bg-surface"
        data-table-scroll=""
      >
        <table
          className={cn('w-full border-separate border-spacing-0 text-sm', CELL_PX[density])}
          data-density={density}
          aria-describedby={`${captionId}-keys`}
        >
          <caption id={captionId} className="sr-only">
            {caption}
          </caption>
          <thead>
            <tr className={cn(ROW_H[density], COARSE)}>
              {selectable ? (
                <th scope="col" className={cn('sticky start-0 top-0 z-30 border-b border-line bg-surface px-0 text-center', SELECT_W)}>
                  <label className="inline-flex h-7 w-10 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      ref={(el) => {
                        if (el) el.indeterminate = !allOnPage && someOnPage;
                      }}
                      disabled={eligibleOnPage.length === 0 || status !== 'ready'}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          for (const x of eligibleOnPage) {
                            if (allOnPage) next.delete(x);
                            else next.add(x);
                          }
                          return next;
                        })
                      }
                      aria-label={copy.selectAll}
                      className="h-4 w-4 accent-primary"
                    />
                  </label>
                </th>
              ) : null}
              {visible.map(headerCell)}
              {rowActions ? (
                <th scope="col" className="sticky end-0 top-0 z-30 border-b border-line bg-surface px-2">
                  <span className="sr-only">{copy.actions}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody ref={body} onKeyDown={onBodyKeyDown}>
            {bodyRows}
          </tbody>
          {totals && totalsCol && status === 'ready' && sorted.length > 0 ? (
            <tfoot>
              <tr className={cn(ROW_H[density], COARSE, 'font-semibold text-ink')} data-totals="">
                {selectable ? <td className={cn('sticky bottom-0 start-0 z-30 border-t border-line bg-surface-2', SELECT_W)} /> : null}
                {visible.map((c, i) =>
                  c.id === totals.columnId ? (
                    <td key={c.id} data-totals-cell="" className={cn(NUM_ALIGN, 'sticky bottom-0 z-20 whitespace-nowrap border-t border-line bg-surface-2 px-[var(--cell-px,16px)]')}>
                      <NumValue value={totals.sumAgorot} kind="money" decimals={c.decimals} />
                    </td>
                  ) : (
                    <td
                      key={c.id}
                      className={cn(
                        'sticky bottom-0 z-20 whitespace-nowrap border-t border-line bg-surface-2 px-[var(--cell-px,16px)]',
                        c.identity && cn('z-30 start-0', selectable && 'start-10'),
                      )}
                    >
                      {i === 0 ? copy.totals(totals.count) : null}
                    </td>
                  ),
                )}
                {rowActions ? <td className="sticky bottom-0 end-0 z-30 border-t border-line bg-surface-2" /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
        <p id={`${captionId}-keys`} className="sr-only">
          {copy.keysHint}
        </p>
      </div>
      {status === 'ready' && sorted.length > 0 ? footer : null}
      {peekPanel}
    </div>
  );
}
