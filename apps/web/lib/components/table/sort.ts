import type { ColumnDef, ColumnKind, SortSpec } from './types';

/**
 * Sort contract (Primer DataTable, lens-exec-desktop §3.5):
 * - exactly one column is sorted at a time, and it never cycles back to "none";
 * - ₪ and numeric columns sort descending on the first click, text and dates ascending;
 * - empty values sort last in either direction.
 */

const NUMERIC_FIRST_DESC: ReadonlySet<ColumnKind> = new Set(['money', 'number']);

export function firstSortDesc(kind: ColumnKind | undefined): boolean {
  return NUMERIC_FIRST_DESC.has(kind ?? 'text');
}

export function nextSort<Row>(current: SortSpec | null, column: ColumnDef<Row>): SortSpec {
  if (current?.id === column.id) return { id: column.id, desc: !current.desc };
  return { id: column.id, desc: firstSortDesc(column.kind) };
}

export function ariaSortOf(sort: SortSpec | null, columnId: string): 'ascending' | 'descending' | undefined {
  if (!sort || sort.id !== columnId) return undefined;
  return sort.desc ? 'descending' : 'ascending';
}

type SortValue = string | number | null | undefined;

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    collators.set(locale, c);
  }
  return c;
}

export function compareValues(a: SortValue, b: SortValue, desc: boolean, locale = 'he'): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const base =
    typeof a === 'number' && typeof b === 'number' ? a - b : collator(locale).compare(String(a), String(b));
  return desc ? -base : base;
}

/** Stable sort by one column; ties keep the input order (the server's order). */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  sort: SortSpec | null,
  locale = 'he',
): Row[] {
  const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
  if (!sort || !col?.value) return [...rows];
  const get = col.value;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => compareValues(x.v, y.v, sort.desc, locale) || x.i - y.i)
    .map((x) => x.row);
}
