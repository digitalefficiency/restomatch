import type { Selectability } from './types';

/**
 * Batch-selection rules (RUBRIC C2, R-12):
 * - `block` rows are never selectable; the caller passes a visible reason.
 * - Select-all takes only eligible rows at or below the per-item cap.
 * - The bar's ₪ is Σ|amount| of the selection, in integer agorot.
 * - Batch actions receive only eligible rows within the cap.
 */

/**
 * R-12 per-item cap for any ₪-moving batch: ₪200. The owner rejected bulk
 * approval at any cap (REVIEW-REPORT §8), so no batch action may approve or
 * pay; the cap still bounds the other batch actions callers add.
 */
export const DEFAULT_BULK_CAP_AGOROT = 20_000;

export interface SelectionRules<Row> {
  rowKey: (row: Row) => string;
  selectable?: (row: Row) => Selectability;
  amountAgorot?: (row: Row) => number;
  capAgorot?: number | null;
}

export function disabledReason<Row>(rules: SelectionRules<Row>, row: Row): string | null {
  const s = rules.selectable?.(row) ?? true;
  return s === true ? null : s.disabled;
}

export function isOverCap<Row>(rules: SelectionRules<Row>, row: Row): boolean {
  const cap = rules.capAgorot === undefined ? DEFAULT_BULK_CAP_AGOROT : rules.capAgorot;
  if (cap == null || !rules.amountAgorot) return false;
  return Math.abs(rules.amountAgorot(row)) > cap;
}

/** The ids select-all would take from `rows` (eligible and within the cap). */
export function selectAllIds<Row>(rules: SelectionRules<Row>, rows: readonly Row[]): string[] {
  return rows.filter((r) => disabledReason(rules, r) == null && !isOverCap(rules, r)).map(rules.rowKey);
}

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export interface SelectionSummary<Row> {
  /** Rows the batch actions act on: selected, eligible and within the cap. */
  actionable: Row[];
  /** Selected rows held back because they are above the cap. */
  overCap: Row[];
  count: number;
  /** Σ|amount| of `actionable`, integer agorot. */
  sumAgorot: number;
}

export function summarize<Row>(
  rules: SelectionRules<Row>,
  rows: readonly Row[],
  selected: ReadonlySet<string>,
): SelectionSummary<Row> {
  const actionable: Row[] = [];
  const overCap: Row[] = [];
  for (const r of rows) {
    if (!selected.has(rules.rowKey(r)) || disabledReason(rules, r) != null) continue;
    (isOverCap(rules, r) ? overCap : actionable).push(r);
  }
  const sumAgorot = rules.amountAgorot
    ? actionable.reduce((s, r) => s + Math.abs(rules.amountAgorot!(r)), 0)
    : 0;
  return { actionable, overCap, count: actionable.length + overCap.length, sumAgorot };
}
