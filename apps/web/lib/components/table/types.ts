import type { ReactNode } from 'react';

/**
 * DataTable contracts (docs/ux/IMPLEMENTATION-PLAN.md §1.2, lens-exec-desktop §3.5).
 * Money crosses into the table as integer agorot; display goes through
 * `formatIls()` / `formatNumber()` only at the cell.
 */

export type Density = 'compact' | 'default' | 'touch';
export const DENSITIES: readonly Density[] = ['compact', 'default', 'touch'];

/** A cell that has no value to show — never a "—" filler, never ₪0 (A4). */
export type CellState = 'na' | 'pending' | 'unavailable';

export type ColumnKind = 'text' | 'money' | 'number' | 'date' | 'status';

export interface ColumnDef<Row> {
  id: string;
  header: string;
  kind?: ColumnKind;
  /** Sort value. Money columns return agorot; text returns a string; dates return epoch ms. */
  value?: (row: Row) => string | number | null | undefined;
  /** Custom cell; defaults to the formatted `value`. Return a CellState to render that state. */
  cell?: (row: Row) => ReactNode | CellState;
  /** Fixed decimals for money / number columns (one precision per column, B3e). */
  decimals?: number;
  sortable?: boolean;
  /** The identity column: sticky at inline-start, wraps before it truncates. */
  identity?: boolean;
  /** Can the user hide it from ColumnsMenu? Identity columns never hide. */
  hideable?: boolean;
  /** Hidden until the user turns it on. */
  defaultHidden?: boolean;
  /** Tailwind width class, e.g. `w-32`. */
  width?: string;
  /** Plain text for the CSV export; defaults to `value`. */
  exportValue?: (row: Row) => string | number | null | undefined;
  /** Hide in MobileCardList (line 1 shows identity + the first money column). */
  mobile?: 'primary' | 'secondary' | 'hidden';
}

export interface SortSpec {
  id: string;
  desc: boolean;
}

/** `true` → selectable; `{ disabled }` → visible checkbox, disabled with a visible reason. */
export type Selectability = true | { disabled: string };

export interface BatchAction<Row> {
  id: string;
  label: (count: number, sumAgorot: number) => string;
  primary?: boolean;
  /** Runs once per eligible row (the existing per-item procedure); never a bulk engine. */
  run: (rows: Row[]) => void | Promise<void>;
}

export interface TableView {
  id: string;
  label: string;
  count?: number;
  sumAgorot?: number;
}

/** Server-computed totals: the table never sums only the loaded page (B3). */
export interface TableTotals {
  count: number;
  sumAgorot?: number;
}
