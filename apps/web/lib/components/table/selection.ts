import type { Selectability } from './types';

/**
 * Batch-selection rules (RUBRIC C2, R-12):
 * - `block` rows are never selectable; the caller passes a visible reason.
 * - Select-all takes only eligible rows with a known amount at or below the per-item cap.
 * - The bar's ₪ is Σ|amount| of the selected rows with a known amount, in integer agorot.
 * - Only a capped (approve/pay) action is limited to in-cap known rows; export,
 *   assign and the like act on the whole selection.
 */

/**
 * R-12 per-item cap for bulk approval: ₪200 per invoice (owner-confirmed, REVIEW-REPORT §8).
 * TODO(W2-04): the single server-side constant lives next to approvals.decideMany; read it from there.
 */
export const DEFAULT_BULK_CAP_AGOROT = 20_000;

export interface SelectionRules<Row> {
  rowKey: (row: Row) => string;
  selectable?: (row: Row) => Selectability;
  /** Integer agorot; `null`/`undefined`/NaN means unknown (e.g. a pending gap) and fails closed. */
  amountAgorot?: (row: Row) => number | null | undefined;
  capAgorot?: number | null;
}

export function disabledReason<Row>(rules: SelectionRules<Row>, row: Row): string | null {
  const s = rules.selectable?.(row) ?? true;
  return s === true ? null : s.disabled;
}

function knownAmount<Row>(rules: SelectionRules<Row>, row: Row): number | null {
  const v = rules.amountAgorot?.(row);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Why a row can't go into a capped (approve/pay) batch: its amount is above the
 * cap, or unknown. An unknown amount is never treated as ₪0.
 */
export function isHeldBack<Row>(rules: SelectionRules<Row>, row: Row): 'overCap' | 'unknown' | null {
  const cap = rules.capAgorot === undefined ? DEFAULT_BULK_CAP_AGOROT : rules.capAgorot;
  if (cap == null || !rules.amountAgorot) return null;
  const v = knownAmount(rules, row);
  if (v == null) return 'unknown';
  return Math.abs(v) > cap ? 'overCap' : null;
}

/** The ids select-all would take from `rows`: eligible, known amount, within the cap. */
export function selectAllIds<Row>(rules: SelectionRules<Row>, rows: readonly Row[]): string[] {
  return rows.filter((r) => disabledReason(rules, r) == null && isHeldBack(rules, r) == null).map(rules.rowKey);
}

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export interface SelectionSummary<Row> {
  /** Every selected, eligible (non-block) row: what export, assign and the like act on. */
  selected: Row[];
  /** The subset a capped (approve/pay) action may take: known amount, within the cap. */
  withinCap: Row[];
  overCapCount: number;
  /** Selected rows whose amount is unknown (pending); never counted as ₪0. */
  unknownCount: number;
  /** False when the table has no amount accessor at all: a capped action then can't run. */
  hasAmount: boolean;
  count: number;
  /** Σ|amount| of the selected rows whose amount is known, integer agorot. */
  sumAgorot: number;
  /** Σ|amount| of `withinCap`. */
  withinCapSumAgorot: number;
}

export function summarize<Row>(
  rules: SelectionRules<Row>,
  rows: readonly Row[],
  selected: ReadonlySet<string>,
): SelectionSummary<Row> {
  const out: SelectionSummary<Row> = {
    selected: [],
    withinCap: [],
    overCapCount: 0,
    unknownCount: 0,
    hasAmount: !!rules.amountAgorot,
    count: 0,
    sumAgorot: 0,
    withinCapSumAgorot: 0,
  };
  for (const r of rows) {
    if (!selected.has(rules.rowKey(r)) || disabledReason(rules, r) != null) continue;
    out.selected.push(r);
    if (!out.hasAmount) continue;
    const v = knownAmount(rules, r);
    if (v == null) {
      out.unknownCount++;
      continue;
    }
    out.sumAgorot += Math.abs(v);
    if (isHeldBack(rules, r) === 'overCap') out.overCapCount++;
    else {
      out.withinCap.push(r);
      out.withinCapSumAgorot += Math.abs(v);
    }
  }
  out.count = out.selected.length;
  return out;
}

export type BatchBlockReason = 'notEnforced' | 'overCap' | 'unknown' | null;

/**
 * What one batch action may do with the current selection. A non-capped action
 * (export, assign) takes every selected row. A capped action (approve, pay)
 * takes only in-cap rows with a known amount, and is disabled — with a reason —
 * while the selection holds any other row, or while the host has not declared
 * that the server enforces the cap (`serverEnforced`).
 */
export function batchActionState<Row>(
  action: { capped?: boolean; serverEnforced?: boolean },
  summary: SelectionSummary<Row>,
): { rows: Row[]; sumAgorot: number; disabled: boolean; reason: BatchBlockReason } {
  if (!action.capped) {
    return { rows: summary.selected, sumAgorot: summary.sumAgorot, disabled: summary.count === 0, reason: null };
  }
  // No amount accessor means every amount is unknown: a capped action never runs uncapped.
  if (!summary.hasAmount) return { rows: [], sumAgorot: 0, disabled: true, reason: 'unknown' };
  const reason: BatchBlockReason = !action.serverEnforced
    ? 'notEnforced'
    : summary.unknownCount > 0
      ? 'unknown'
      : summary.overCapCount > 0
        ? 'overCap'
        : null;
  return {
    rows: summary.withinCap,
    sumAgorot: summary.withinCapSumAgorot,
    disabled: reason != null || summary.withinCap.length === 0,
    reason,
  };
}

/**
 * Selection after a batch run: rows that succeeded leave it (so a retry never
 * re-submits them); rows that failed, and rows the action did not target, stay.
 */
export function afterBatch(
  selected: ReadonlySet<string>,
  targetIds: readonly string[],
  outcomes: readonly ('ok' | 'failed')[],
): { selected: Set<string>; failed: number } {
  const next = new Set(selected);
  let failed = 0;
  targetIds.forEach((id, i) => {
    if (outcomes[i] === 'ok') next.delete(id);
    else failed++;
  });
  return { selected: next, failed };
}

/**
 * How the BatchBar shows the selection's ₪: an all-unknown selection is the
 * pending state (never "0.00 ₪"); otherwise the known Σ plus how many rows have
 * no known amount yet.
 */
export function sumDisplay<Row>(
  summary: SelectionSummary<Row>,
): { kind: 'pending' } | { kind: 'sum'; sumAgorot: number; unknownCount: number } {
  if (summary.count > 0 && summary.unknownCount === summary.count) return { kind: 'pending' };
  return { kind: 'sum', sumAgorot: summary.sumAgorot, unknownCount: summary.unknownCount };
}
