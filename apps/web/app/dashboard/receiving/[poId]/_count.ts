/**
 * The Delivery Check's count model: what the receiver established about one
 * line, and how. A count is evidence, so it NEVER comes from the document
 * being checked: nothing here reads an invoice quantity, and a line nobody
 * counted is `uncounted`, never "whatever was billed" (a short delivery that
 * was fully billed must not pass at ₪0).
 *
 * Pure and self-contained (no showcase state) — the wizard maps its UI marks
 * onto it at the gr_line boundary: what is saved (`toGrLine`) and what a
 * reload restores (`fromGrLine`).
 */

/** How the count was taken. Until gr_lines has a column for it (G-03) it rides in condition_notes. */
export type CountMethod = 'per_line' | 'bulk_as_ordered' | 'spot_check';

export type CountOutcome = 'as_ordered' | 'counted' | 'missing' | 'damaged';

export type LineCount =
  | { kind: 'uncounted' }
  | { kind: 'counted'; qtyReceived: number; qtyRejected: number; outcome: CountOutcome; method: CountMethod };

export const UNCOUNTED: LineCount = { kind: 'uncounted' };

/** The writable gr_line columns (receiving.markGrLine overwrites the whole row). */
export interface GrLineFields {
  qtyReceived: number;
  qtyRejected: number;
  rejectReason?: string;
  condition: 'ok' | 'damaged' | 'rejected';
  conditionNotes?: string;
}

/** A gr_line as read back (getReceipt numerics arrive as strings). */
export interface StoredGrLine {
  qtyReceived: string | number | null;
  qtyRejected: string | number | null;
  rejectReason?: string | null;
  condition?: 'ok' | 'damaged' | 'rejected' | null;
  conditionNotes?: string | null;
}

const EPS = 0.0005;
const METHOD_RE = /\bcount:(bulk_as_ordered|spot_check|per_line)\b/;

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `count:<method>` in condition_notes; per-line counts (the default) carry no token. */
export function methodToken(method: CountMethod): string | null {
  return method === 'per_line' ? null : `count:${method}`;
}

export function readMethod(notes: string | null | undefined): CountMethod {
  const m = METHOD_RE.exec(notes ?? '');
  return (m?.[1] as CountMethod | undefined) ?? 'per_line';
}

/** The notes without the method token (what a person wrote). */
export function stripMethod(notes: string | null | undefined): string {
  return (notes ?? '').replace(METHOD_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function outcomeFor(qtyReceived: number, qtyRejected: number, ordered: number | null, reason: string | null, damaged: boolean): CountOutcome {
  if (reason === 'missing') return 'missing';
  if (damaged) return 'damaged';
  if (ordered !== null && qtyRejected <= EPS && Math.abs(qtyReceived - ordered) <= EPS) return 'as_ordered';
  return 'counted';
}

/**
 * What a saved gr_line says. A fresh row (0 received, 0 rejected, no reason,
 * no method) is "not counted yet"; 0 with reason `missing` is "missing".
 */
export function fromGrLine(row: StoredGrLine | undefined, ordered: number | null): LineCount {
  if (!row) return UNCOUNTED;
  const qtyReceived = num(row.qtyReceived);
  const qtyRejected = num(row.qtyRejected);
  const reason = row.rejectReason ?? null;
  const notes = row.conditionNotes ?? null;
  const damaged = reason === 'damaged' || row.condition === 'damaged' || /^damaged/.test(notes ?? '');
  const hasMethod = METHOD_RE.test(notes ?? '');
  const counted = qtyReceived > EPS || qtyRejected > EPS || reason !== null || damaged || hasMethod;
  if (!counted) return UNCOUNTED;
  return {
    kind: 'counted',
    qtyReceived: reason === 'missing' ? 0 : qtyReceived,
    qtyRejected: reason === 'missing' ? 0 : qtyRejected,
    outcome: outcomeFor(qtyReceived, qtyRejected, ordered, reason, damaged),
    method: readMethod(notes),
  };
}

/** The gr_line row to save. `uncounted` is the fresh row (an undo resets the line). */
export function toGrLine(count: LineCount, notes?: string | null): GrLineFields {
  if (count.kind === 'uncounted') return { qtyReceived: 0, qtyRejected: 0, condition: 'ok' };
  const token = methodToken(count.method);
  const text = [stripMethod(notes), token].filter(Boolean).join(' ');
  const base = { ...(text ? { conditionNotes: text } : {}) };
  switch (count.outcome) {
    case 'missing':
      // Never arrived: 0 received and NOTHING rejected (the slip says "חסר", never "נפסל").
      return { qtyReceived: 0, qtyRejected: 0, rejectReason: 'missing', condition: 'ok', ...base };
    case 'damaged':
      return { qtyReceived: count.qtyReceived, qtyRejected: count.qtyRejected, rejectReason: 'damaged', condition: 'damaged', ...base };
    default:
      return {
        qtyReceived: count.qtyReceived,
        qtyRejected: count.qtyRejected,
        condition: count.qtyRejected > EPS ? 'rejected' : 'ok',
        ...base,
      };
  }
}

/** Does this (unsent) row hold a count, or is it the reset to "not counted"? */
export function grLineIsCounted(f: GrLineFields): boolean {
  return fromGrLine(f, null).kind === 'counted';
}

/** "Arrived as ordered" for a line nobody counted one by one (the bulk action). */
export function bulkAsOrdered(ordered: number): LineCount {
  return { kind: 'counted', qtyReceived: ordered, qtyRejected: 0, outcome: 'as_ordered', method: 'bulk_as_ordered' };
}

/** The engine's quantity tolerance (DEFAULT_TOLERANCES shape). */
export interface CountTolerance {
  qtyPercent: number;
  qtyAbsolute: number;
}

/** A blind spot count agrees with the order the way the engine calls a quantity clean. */
export function spotCountMatches(counted: number, ordered: number, tol: CountTolerance | undefined): boolean {
  const diff = Math.abs(counted - ordered);
  if (diff <= EPS) return true;
  if (!tol || ordered <= 0) return false;
  return diff <= Math.max(tol.qtyAbsolute, ordered * tol.qtyPercent) && diff / ordered <= tol.qtyPercent;
}

/** How many lines the receiver counts blind before a bulk "as ordered". */
export const SPOT_CHECK_LINES = 2;

/** Pick the spot-check lines at random (Fisher–Yates over a copy). */
export function pickSpotCheck<T>(items: readonly T[], n: number = SPOT_CHECK_LINES, rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.min(n, a.length));
}
