import { cn } from '../cn';

/**
 * The three-way table of the approvals desk (DS3-04 §2.3, §4.4; SPEC §10.2 "ordered · received · billed"):
 * a real <table> with an sr-only caption, three column headers and two row headers (quantity, unit price).
 * Generic — no approvals types, no i18n: the caller hands in the words and the cell contents; this component
 * owns the structure, the one flagged cell's tint and the tone of the gap written beside its value. Values
 * stay ink in every cell (the gap is a quantity or a percent, never a ₪), and every cell carries `.num`, so
 * digits keep tabular widths in any face (§11.1). Server-safe (no hooks).
 *
 * Two literal class maps (§4.0): 'responsive' switches at xl (1280 px); 'narrow' (the landing) uses the
 * narrow values unprefixed. Compact applies at xl only, through the desk root's `data-density`
 * (`xl:group-data-[density=compact]/desk:`), and only when the caller says the desk is compact.
 */

export interface MatchCellView {
  content: React.ReactNode;
  flagged?: boolean;
  gap?: React.ReactNode;
  cell: 'ordered' | 'received' | 'billed';
}
export interface MatchColumn {
  label: string;
  sub?: React.ReactNode;
}
/** `sub` renders `block text-caption text-fg-tertiary` under the row header (the unit-price row passes the basis
 *  "לפני מע״מ", R7g). */
export interface MatchRow {
  label: string;
  sub?: React.ReactNode;
  cells: [MatchCellView, MatchCellView, MatchCellView];
}
export interface MatchTableProps {
  caption: string; // sr-only
  columns: [MatchColumn, MatchColumn, MatchColumn]; // ordered, received, billed
  rows: [MatchRow, MatchRow]; // quantity, unit price
  tone: 'leak' | 'warn' | 'neutral';
  compact: boolean; // the desk's density (xl only)
  layout: 'responsive' | 'narrow'; // 'narrow' = landing (narrow classes unprefixed)
  className?: string;
}

/** Forced colours drop the tint: the flagged cell gets an outline on the focus dial (§4 FC_OUTLINE). */
const FC_OUTLINE =
  'forced-colors:[outline:var(--focus-width)_solid_Highlight] forced-colors:[outline-offset:calc(var(--focus-width)*-1)]';

const TINT: Record<MatchTableProps['tone'], string> = {
  leak: 'bg-danger-subtle shadow-[inset_0_0_0_1px_rgb(var(--c-danger-border-subtle))]',
  warn: 'bg-warn-subtle shadow-[inset_0_0_0_1px_rgb(var(--c-warn-border-subtle))]',
  neutral: 'bg-surface-sunken shadow-[inset_0_0_0_1px_rgb(var(--c-neutral-border-subtle))]',
};

const GAP_TONE: Record<MatchTableProps['tone'], string> = {
  leak: 'text-danger',
  warn: 'text-warn',
  neutral: 'text-fg-secondary',
};

const CLS = {
  responsive: {
    root: 'mt-4 overflow-hidden rounded-card border border-line-rule bg-surface',
    firstCol: 'w-[7.25rem] max-xl:w-[3.625rem]',
    colHead: 'px-4 py-2 text-start align-middle max-xl:px-1.5',
    colSub: 'block truncate text-caption text-fg-tertiary max-xl:hidden',
    rowHead: 'border-t border-line-rule px-4 py-2.5 text-start text-caption font-normal text-fg-secondary max-xl:px-1.5',
    cell: 'num border-s border-t border-line-rule px-4 py-2.5 max-xl:px-1.5 max-xl:py-2',
    gap: 'ms-auto self-center whitespace-nowrap text-caption font-semibold max-xl:ms-0 max-xl:whitespace-normal',
  },
  narrow: {
    root: 'mt-4 overflow-hidden rounded-card border border-line-rule bg-surface',
    firstCol: 'w-[3.625rem]',
    colHead: 'px-1.5 py-2 text-start align-middle',
    colSub: null, // the column sub-captions are hidden on narrow and in single mode
    rowHead: 'border-t border-line-rule px-1.5 py-2.5 text-start text-caption font-normal text-fg-secondary',
    cell: 'num border-s border-t border-line-rule px-1.5 py-2',
    gap: 'ms-0 self-center whitespace-normal text-caption font-semibold',
  },
} as const;

/** §4.9 compact (xl only): the table mt-3, cells px-3.5 py-1.5 (the column heads keep py-2). */
const COMPACT = {
  root: 'xl:group-data-[density=compact]/desk:mt-3',
  colHead: 'xl:group-data-[density=compact]/desk:px-3.5',
  cell: 'xl:group-data-[density=compact]/desk:px-3.5 xl:group-data-[density=compact]/desk:py-1.5',
} as const;

const shown = (node: React.ReactNode): boolean => node != null && node !== false && node !== '';

export function MatchTable({ caption, columns, rows, tone, compact, layout, className }: MatchTableProps) {
  const cls = CLS[layout];
  const dense = compact && layout === 'responsive';
  return (
    <div data-testid="match-table" className={cn(cls.root, dense && COMPACT.root, className)}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-start">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className={cls.firstCol} />
          <col />
          <col />
          <col />
        </colgroup>
        <thead className="bg-surface-sunken">
          <tr>
            <td />
            {columns.map((col, i) => (
              <th key={i} scope="col" className={cn(cls.colHead, dense && COMPACT.colHead)}>
                <b className="block text-body-sm font-semibold text-fg">{col.label}</b>
                {cls.colSub && shown(col.sub) ? <span className={cls.colSub}>{col.sub}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <th scope="row" className={cn(cls.rowHead, dense && COMPACT.cell)}>
                {row.label}
                {shown(row.sub) ? <span className="block text-caption text-fg-tertiary">{row.sub}</span> : null}
              </th>
              {row.cells.map((c) =>
                c.flagged ? (
                  <td
                    key={c.cell}
                    data-testid="match-cell-off"
                    data-cell={c.cell}
                    className={cn(cls.cell, dense && COMPACT.cell, TINT[tone], FC_OUTLINE, 'font-semibold text-fg')}
                  >
                    {shown(c.gap) ? (
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {c.content}
                        <span className={cn(cls.gap, GAP_TONE[tone])}>{c.gap}</span>
                      </div>
                    ) : (
                      c.content
                    )}
                  </td>
                ) : (
                  <td key={c.cell} className={cn(cls.cell, dense && COMPACT.cell)}>
                    {c.content}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
