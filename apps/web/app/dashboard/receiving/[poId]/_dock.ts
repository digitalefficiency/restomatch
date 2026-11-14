/**
 * The dock count as the receiver sees it (DS3-05, SPEC §10.3): one row per item,
 * a tick that means "arrived as ordered", a button at the bottom that always
 * says the next step, and a short check before closing only when there is
 * something to check.
 *
 * Pure — unit-tested (__tests__/dock.test.ts). Every rule here is read from the
 * wizard's existing model, never re-decided: the marks and patches of
 * showcase/receiver/_state.ts and the engine's own quantity tolerance
 * (qtyEntry.outsideTolerance, the matching engine's rule).
 */
import type { ReconciliationLine, ReconciliationResult } from '@/app/showcase/receiver/_mock';
import { countProgress, lineKey, unresolvedOrderLines, type LineMark } from '@/app/showcase/receiver/_state';
import { outsideTolerance, roundQty, type QtyTolerance } from '@/app/showcase/receiver/_steps/qtyEntry';

/** open: nobody counted it · ok: arrived as ordered (or, not on the order, did not arrive) · gap: anything else counted. */
export type RowState = 'open' | 'ok' | 'gap';

const onOrder = (line: ReconciliationLine): boolean => line.poLineId !== null && line.poQty !== null;
const missing = (mark: LineMark): boolean => mark.rejectReason === 'missing';
/** Damaged, or rejected on an earlier visit: the dock says "פגום" for both. */
const hurt = (mark: LineMark): boolean => !missing(mark) && (mark.condition !== 'ok' || mark.qtyRejected > 0);

/**
 * The count agrees with the order: exactly, or inside the engine's quantity
 * tolerance (what the matching engine itself calls clean — 28 of 28.5 kg is not
 * a gap, 8 of 10 units is).
 */
export function qtyAgrees(line: ReconciliationLine, qty: number, tolerance?: QtyTolerance): boolean {
  if (line.poQty === null) return false;
  if (roundQty(qty) === roundQty(line.poQty)) return true;
  return !!tolerance && qty > 0 && outsideTolerance(line.poQty, qty, tolerance) === null;
}

/** Arrived as ordered, in good condition: what a pressed tick says. */
export function isAsOrdered(line: ReconciliationLine, mark: LineMark | undefined, tolerance?: QtyTolerance): boolean {
  return onOrder(line) && !!mark?.touched && mark.rejectReason == null && !hurt(mark) && qtyAgrees(line, mark.qtyReceived, tolerance);
}

/**
 * The row's state, from the count against the order only (what the dock knows).
 * A line that is not on the order and arrived is a gap; one that did not arrive
 * leaves nothing to say.
 */
export function rowState(line: ReconciliationLine, mark: LineMark | undefined, tolerance?: QtyTolerance): RowState {
  if (!mark?.touched) return 'open';
  if (!onOrder(line)) return missing(mark) ? 'ok' : 'gap';
  return isAsOrdered(line, mark, tolerance) ? 'ok' : 'gap';
}

/**
 * What the row says under the item's name (the component words it; null = nothing
 * to add). The count itself sits at the row's end: a row reads "חסר", "הגיע פגום"
 * or the quantity (SPEC §10.3).
 */
export type RowNote =
  | { kind: 'ordered'; ordered: number; damaged: boolean }
  | { kind: 'notOrdered' }
  | { kind: 'missing' }
  | { kind: 'damaged' }
  | { kind: 'bulk' }
  | null;

export function rowNote(line: ReconciliationLine, mark: LineMark | undefined, tolerance?: QtyTolerance): RowNote {
  const state = rowState(line, mark, tolerance);
  if (!onOrder(line)) return state === 'ok' ? null : { kind: 'notOrdered' };
  if (state === 'open') return { kind: 'ordered', ordered: line.poQty!, damaged: false };
  const m = mark!;
  if (state === 'ok') return m.method === 'bulk_as_ordered' ? { kind: 'bulk' } : null;
  if (missing(m)) return { kind: 'missing' };
  if (qtyAgrees(line, m.qtyReceived, tolerance)) return { kind: 'damaged' };
  return { kind: 'ordered', ordered: line.poQty!, damaged: hurt(m) };
}

/**
 * The invoiced quantity beside the order, as the count row shows it today when
 * the invoice was read and says something else (only in today's order of steps:
 * a count before the photo has no invoice line to show).
 */
export function billedBeside(line: ReconciliationLine): number | null {
  if (line.invoiceQty === null) return null;
  if (line.poQty !== null && roundQty(line.invoiceQty) === roundQty(line.poQty)) return null;
  return line.invoiceQty;
}

/** Lines the receiver should see first: the invoice differs in a way that needs eyes (as today). */
const NEEDS_EYES = new Set(['qty_diff', 'unordered', 'missing_from_invoice']);
export function orderedForCount(lines: ReconciliationLine[]): ReconciliationLine[] {
  return [...lines.filter((l) => NEEDS_EYES.has(l.status)), ...lines.filter((l) => !NEEDS_EYES.has(l.status))];
}

/**
 * The quantity sheet's plain statement when a number is far from the order
 * (outside the engine's tolerance), above the keys so no key moves under the
 * thumb. 0 is "missing", never a note; more than double reads "יותר מפי 2".
 */
export type FarNote = { kind: 'pct'; pct: number; ordered: number } | { kind: 'double'; ordered: number } | null;
export function farNote(line: ReconciliationLine, value: number | null, tolerance: QtyTolerance | undefined): FarNote {
  if (value === null || value === 0 || !tolerance || !onOrder(line)) return null;
  const pct = outsideTolerance(line.poQty, value, tolerance);
  if (pct === null) return null;
  return pct > 1 ? { kind: 'double', ordered: line.poQty! } : { kind: 'pct', pct, ordered: line.poQty! };
}

/** The one button at the bottom of the count: it always says the next step. */
export type MainAction =
  | { kind: 'closing' }
  | { kind: 'all'; count: number }
  | { kind: 'rest'; count: number }
  | { kind: 'close' }
  | { kind: 'wait'; remaining: number };

/**
 * Today's rules (AdjustQuantities), one button instead of a disabled close under
 * a text button: nothing counted → "everything arrived (N)"; some counted →
 * "mark the rest (N)"; every line resolved → close. Both bulk actions start
 * with the blind spot check (owner decision 20); after a spot check that found
 * a difference, or with only lines that are not on the order left, the close
 * waits until every line is resolved.
 */
export function mainAction(input: {
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  spotMismatch: boolean;
  closing: boolean;
}): MainAction {
  const { result, marks, spotMismatch, closing } = input;
  if (closing) return { kind: 'closing' };
  const { resolved, total } = countProgress(result, marks);
  const rest = unresolvedOrderLines(result, marks).length;
  if (rest > 0 && !spotMismatch) return resolved === 0 ? { kind: 'all', count: rest } : { kind: 'rest', count: rest };
  if (total > 0 && resolved === total) return { kind: 'close' };
  return { kind: 'wait', remaining: total - resolved };
}

/** How a gap reads in the check before closing and on the end screen. */
export type GapNote =
  | { kind: 'missing' }
  | { kind: 'damaged' }
  | { kind: 'short'; got: number; ordered: number; damaged: boolean }
  | { kind: 'over'; got: number; ordered: number; damaged: boolean }
  | { kind: 'unordered'; got: number };

/** A line to name before closing and on the end screen: counted, and not as ordered. */
export interface DockGap {
  key: string;
  line: ReconciliationLine;
  mark: LineMark;
  note: GapNote;
}

export function gapNote(line: ReconciliationLine, mark: LineMark, tolerance?: QtyTolerance): GapNote | null {
  if (rowState(line, mark, tolerance) !== 'gap') return null;
  if (!onOrder(line)) return { kind: 'unordered', got: roundQty(mark.qtyReceived) };
  if (missing(mark)) return { kind: 'missing' };
  if (qtyAgrees(line, mark.qtyReceived, tolerance)) return { kind: 'damaged' };
  const got = roundQty(mark.qtyReceived);
  const ordered = roundQty(line.poQty!);
  return { kind: got < ordered ? 'short' : 'over', got, ordered, damaged: hurt(mark) };
}

/**
 * The gaps the count itself shows (missing, short, over, damaged, an item that
 * is not on the order and arrived): what the receiver writes on the delivery
 * note too. Only the count against the order: what was billed, and at what
 * price, is the dock slip's and the approvals desk's to say (SPEC principle 3:
 * at the dock only ordered and received appear). Lines nobody counted are not
 * gaps: closing waits until every line is resolved anyway.
 */
export function dockGaps(result: ReconciliationResult | null, marks: Record<string, LineMark>, tolerance?: QtyTolerance): DockGap[] {
  if (!result) return [];
  const out: DockGap[] = [];
  for (const line of orderedForCount(result.lines)) {
    const key = lineKey(line);
    const mark = marks[key];
    if (!mark) continue;
    const note = gapNote(line, mark, tolerance);
    if (note) out.push({ key, line, mark, note });
  }
  return out;
}

/**
 * Whether closing first shows the short check. A clean receipt closes in one
 * tap, as today. A gap always shows it. The photo is asked about only when the
 * document comes after the count (flag `dockCountFirst`): in today's order the
 * photo came first, or the receiver chose "no invoice now" at the start.
 */
export function needsCloseCheck(input: { gaps: number; photographed: boolean; countFirst: boolean }): boolean {
  return input.gaps > 0 || (input.countFirst && !input.photographed);
}
