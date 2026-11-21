/**
 * The approvals desk's state machine (DS3-04 spec §2.6; eng.md §2.2-§2.5). Pure: state and an action in, a new state
 * out — no React, no tRPC, no URL. `use-desk.ts` owns the side effects (the six mutations, `?sel=`, the summary
 * refresh) and dispatches these transitions; the views never read this module.
 *
 * Rows are never removed: a decided row is `done` while its undo lives, then `hidden`, so a failure or an undo puts it
 * back exactly where it was (server order is never changed). Every summary move goes through `adjustSummary`, in
 * integer agorot, and a rollback adds back exactly what the start took away (R11: `decideMany` is atomic).
 */
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { conflictText, parseAmountChanged } from './conflicts';
import { batchBasisBlock } from './desk-facts';
import type {
  DeskControllerInput,
  FocusIntent,
  How,
  Motion,
  Origin,
  QueueItem,
  QueueRowView,
  QueueSummary,
  RowNote,
  RowState,
  UndoView,
} from './desk-types';
import { parseDecidedConflict, resolutionLabel, type WaiveReason } from './vocab';

type T = Translator<typeof approvalsHe>;

/** = the server page (page.tsx myQueue limit 50; [invoiceId]/page.tsx 50): "has more" is right on first paint. */
export const PAGE = 50;
/** The in-flight mark of a bulk / group decision (one at a time). Never a row id (ids are uuids). */
export const BATCH_KEY = 'batch';
/** A duplicate's ₪ (incl. VAT) and a VAT gap's ₪ (the VAT itself) are reported apart from the claimable total (D32). */
const OUTSIDE_CLAIMABLE_TOTAL: ReadonlySet<string> = new Set(['DUPLICATE_INVOICE', 'VAT_MISMATCH']);

/** One decision's procedure and input (spec §5.4): the same procedure with the same input as today. */
export type Decide =
  | { procedure: 'approve' }
  | { procedure: 'reject'; reason: string; reasonCode: WaiveReason | 'reviewed' }
  | { procedure: 'escalate'; note?: string };

/** What "נסו שוב" repeats for a row whose decision did not save (card.error). */
export interface RetryInfo {
  action: Decide;
  doneLabel: string;
  /** The figure the toast names: the claim (claim variant) or |Δ| (the rest), P6. */
  amountKind: 'claim' | 'delta';
}

export type BatchOrigin = 'selection' | 'group';

export interface DeskState {
  /** Loaded rows, server order, never reordered. */
  items: QueueItem[];
  /** Gone from view (decided and settled, or "הסתירו"). */
  hidden: ReadonlySet<string>;
  /** Decided by me while the decision is in flight or its undo is live: a done row. */
  done: ReadonlyMap<string, { result: string }>;
  /** CONFLICT "decided elsewhere": the sentence (`card.decidedBy…`) and the row's result (resolutionLabel). */
  elsewhere: ReadonlyMap<string, { text: string; result: string }>;
  summary: QueueSummary;
  hasMore: boolean;
  loadingMore: boolean;
  /** Ids whose decision request is pending, and BATCH_KEY while a batch is. */
  inFlight: ReadonlySet<string>;
  notes: Readonly<Record<string, RowNote>>;
  /** Per row: the decision "נסו שוב" repeats (only after an error outcome). */
  retry: Readonly<Record<string, RetryInfo>>;
  /** The reasons row (R9): it belongs to one gap and closes on every select / move / nav and on a decision. */
  asking: { id: string; origin: Origin } | null;
  undo: UndoView | null;
  announcement: string;
  /** The bulk selection (desk at ≥ 1280 px only). */
  checked: ReadonlySet<string>;
  /** The BatchBar note of a refused selection (desk.batchConflict | batchError | batchUnknown). */
  batchNote: string | null;
  escalateFor: { id: string; origin: Origin } | null;
  keysOpen: boolean;
  focus: FocusIntent | null;
  motion: Motion;
}

/** The decision outcome when a request fails (eng.md §2.5; order of the checks as list.tsx:279-309). */
export type FailureOutcome =
  | { kind: 'amountChanged'; nowAgorot: number } // CONFLICT + parseAmountChanged(message)
  | { kind: 'escalatedToYou' } // CONFLICT, decided-conflict status 'escalated', and the viewer is the owner
  | { kind: 'elsewhere'; text: string; result: string } // CONFLICT + a decided-conflict → conflictText + resolutionLabel
  | { kind: 'forbidden' } // FORBIDDEN
  | { kind: 'error' }; // anything else (network, 500, offline): retry

/** The shape of a failed tRPC call the outcome reads (TRPCClientError: `data.code`, `message`). */
export interface DecisionError {
  data?: { code?: string } | null;
  message?: string;
}

export type DeskAction =
  | { type: 'decide/start'; ids: string[]; how: How; result: string }
  | { type: 'decide/ok'; ids: string[]; undo: UndoView }
  | { type: 'decide/fail'; ids: string[]; outcome: FailureOutcome; retry?: RetryInfo | null }
  | { type: 'batch/start'; ids: string[]; origin: BatchOrigin; result: string }
  | { type: 'batch/ok'; ids: string[]; undo: UndoView }
  | { type: 'batch/fail'; ids: string[]; origin: BatchOrigin; note: string }
  | { type: 'undo/start'; sentAt: number }
  | { type: 'undo/ok'; ids: string[]; sentAt: number; how: How }
  | { type: 'undo/fail'; sentAt: number; text: string }
  | { type: 'undo/expire'; sentAt?: number }
  | { type: 'summary/set'; summary: QueueSummary }
  | { type: 'rows/append'; rows: QueueItem[]; hasMore: boolean }
  | { type: 'rows/reset'; rows: QueueItem[]; hasMore: boolean }
  | { type: 'loadMore/busy'; busy: boolean }
  | { type: 'ask/open'; id: string; origin: Origin }
  | { type: 'ask/close' }
  | { type: 'check/toggle'; id: string }
  | { type: 'check/clear' }
  | { type: 'escalate/open'; id: string; origin: Origin }
  | { type: 'escalate/close' }
  | { type: 'keys/open'; open: boolean }
  | { type: 'elsewhere/hide'; id: string }
  | { type: 'focus/set'; focus: FocusIntent | null }
  | { type: 'announce'; text: string }
  /** The pure half of select() / move() / the prev-next buttons (the hook writes `?sel=`): the reasons row closes
   *  first (R9); the motion and, when given, the focus intent are set. */
  | { type: 'nav'; motion: Motion; focus?: FocusIntent | null };

export function initDeskState(input: Pick<DeskControllerInput, 'initial' | 'initialSummary'>): DeskState {
  return {
    items: input.initial,
    hidden: new Set(),
    done: new Map(),
    elsewhere: new Map(),
    summary: input.initialSummary,
    hasMore: input.initial.length >= PAGE,
    loadingMore: false,
    inFlight: new Set(),
    notes: {},
    retry: {},
    asking: null,
    undo: null,
    announcement: '',
    checked: new Set(),
    batchNote: null,
    escalateFor: null,
    keysOpen: false,
    focus: null,
    motion: null,
  };
}

// ── summary ───────────────────────────────────────────────────────────────────────────────────

/**
 * The optimistic totals of one decided (−1) or restored (+1) row: list.tsx:197-214 with VAT_MISMATCH joining
 * DUPLICATE_INVOICE outside `claimableIls` (D32; the dup/VAT lines update on refreshSummary). Integer agorot inside;
 * nothing goes below 0.
 */
export function adjustSummary(
  s: QueueSummary,
  d: Pick<QueueItem, 'type' | 'severity' | 'claimable' | 'claimAgorot'>,
  sign: 1 | -1,
): QueueSummary {
  const claim = Number.isFinite(d.claimAgorot) ? Math.trunc(d.claimAgorot) : 0;
  return {
    ...s,
    count: Math.max(0, s.count + sign),
    blockers: Math.max(0, s.blockers + (d.severity === 'block' ? sign : 0)),
    toDecide: d.claimable ? { ...s.toDecide, count: Math.max(0, s.toDecide.count + sign) } : s.toDecide,
    toReview: d.claimable ? s.toReview : { count: Math.max(0, s.toReview.count + sign) },
    claimableIls:
      !d.claimable || OUTSIDE_CLAIMABLE_TOTAL.has(d.type)
        ? s.claimableIls
        : Math.max(0, Math.round(s.claimableIls * 100) + sign * claim) / 100,
  };
}

// ── selectors ─────────────────────────────────────────────────────────────────────────────────

const openId = (s: DeskState, id: string): boolean => !s.hidden.has(id) && !s.done.has(id) && !s.elsewhere.has(id);
const rowOf = (s: DeskState, id: string): QueueItem | undefined => s.items.find((x) => x.id === id);

/** Loaded, not hidden, not decided by me, not decided elsewhere. */
export function isOpenRow(s: DeskState, id: string): boolean {
  return openId(s, id) && s.items.some((x) => x.id === id);
}

export function liveRows(s: DeskState): QueueItem[] {
  return s.items.filter((x) => openId(s, x.id));
}

/** open | done | elsewhere; null for a hidden or unknown row. */
export function rowStateOf(s: DeskState, id: string): RowState | null {
  if (s.hidden.has(id) || !s.items.some((x) => x.id === id)) return null;
  if (s.done.has(id)) return 'done';
  if (s.elsewhere.has(id)) return 'elsewhere';
  return 'open';
}

/** The queue column's rows (not hidden), server order. `roving` sits on exactly one open row: the current one if it
 *  is open, else the first open row (none when nothing is open). */
export function rowsView(s: DeskState, currentId: string | null): QueueRowView[] {
  const visible = s.items.filter((x) => !s.hidden.has(x.id));
  const rovingId =
    currentId != null && openId(s, currentId) && visible.some((x) => x.id === currentId)
      ? currentId
      : (visible.find((x) => openId(s, x.id))?.id ?? null);
  return visible.map((row) => {
    const done = s.done.get(row.id);
    const away = s.elsewhere.get(row.id);
    const state: RowState = done ? 'done' : away ? 'elsewhere' : 'open';
    return {
      row,
      state,
      result: done?.result ?? away?.result ?? null,
      current: row.id === currentId,
      checked: state === 'open' && s.checked.has(row.id),
      roving: row.id === rovingId,
    };
  });
}

/** `?sel=` → the current row: `sel` if it is open or decided elsewhere, else the first live row. Never writes the URL. */
export function resolveCurrent(s: DeskState, sel: string | null): QueueItem | null {
  if (sel != null && !s.hidden.has(sel) && !s.done.has(sel)) {
    const row = rowOf(s, sel);
    if (row) return row;
  }
  return liveRows(s)[0] ?? null;
}

/** After deciding `id`: the first open row after it in server order, wrapping to the first open row before it
 *  (the brief's rule; today the closest previous row came next after the last loaded one, named in §8, P11g). */
export function nextOpenAfter(s: DeskState, id: string, excluding?: ReadonlySet<string>): string | null {
  const ok = (x: QueueItem) => x.id !== id && !excluding?.has(x.id) && openId(s, x.id);
  const at = s.items.findIndex((x) => x.id === id);
  if (at < 0) return s.items.find(ok)?.id ?? null;
  for (let i = at + 1; i < s.items.length; i += 1) if (ok(s.items[i]!)) return s.items[i]!.id;
  for (let i = 0; i < at; i += 1) if (ok(s.items[i]!)) return s.items[i]!.id;
  return null;
}

/** J/K and prev/next: the nearest open row in that direction, done and elsewhere rows skipped, no wrap. From no row
 *  (or an unknown one): the first open row for +1, the last for −1. */
export function stepOpen(s: DeskState, fromId: string | null, delta: 1 | -1): string | null {
  const at = fromId == null ? -1 : s.items.findIndex((x) => x.id === fromId);
  if (at < 0) {
    const live = liveRows(s);
    return (delta > 0 ? live[0] : live[live.length - 1])?.id ?? null;
  }
  for (let i = at + delta; i >= 0 && i < s.items.length; i += delta) {
    const x = s.items[i]!;
    if (openId(s, x.id)) return x.id;
  }
  return null;
}

/** "3 מתוך 12": 1-based in the live rows; total = max(summary.count, live.length). Null when current is not open. */
export function positionOf(s: DeskState, currentId: string | null): { index: number; total: number } | null {
  if (currentId == null) return null;
  const live = liveRows(s);
  const i = live.findIndex((x) => x.id === currentId);
  if (i < 0) return null;
  return { index: i + 1, total: Math.max(s.summary.count, live.length) };
}

/** One replay id per attempt on the same selection (list.tsx:396-429): the same sorted ids keep the id, others get
 *  a fresh one, so a re-tap after a lost response replays (the server answers with the first result). */
export function batchMutationId(
  prev: { key: string; id: string } | null,
  ids: string[],
  fresh: () => string,
): { key: string; id: string } {
  const key = [...ids].sort().join(',');
  return prev?.key === key ? prev : { key, id: fresh() };
}

/** Why a row cannot join a bulk selection or "approve the whole invoice": a block row, or a VAT gap (R6). */
export function batchRefusalOf(row: Pick<QueueItem, 'severity' | 'type'>): 'block' | 'vat' | null {
  return row.severity === 'block' ? 'block' : batchBasisBlock(row);
}

/** The gap the reasons row decides (R9): asking.id while it is open, else nothing — pay() never decides another gap. */
export function askingRow(s: DeskState): QueueItem | null {
  if (!s.asking || !isOpenRow(s, s.asking.id)) return null;
  return rowOf(s, s.asking.id) ?? null;
}

/** Focus after a decision (§5.3): no next gap → the empty state; a keyboard-activated bar button, or a shortcut pressed
 *  with focus on the bar (R15) → the next primary; else the next row (narrow and single resolve a row to the primary). */
export function focusAfterDecision(p: { how: How; origin: Origin; nextId: string | null }): FocusIntent {
  if (p.nextId == null) return { to: 'empty' };
  if (p.origin === 'bar' && p.how !== 'pointer') return { to: 'primary' };
  return { to: 'row', id: p.nextId };
}

/** A failed decision → its outcome, in today's order: amount changed, escalated to me (owner), decided elsewhere,
 *  FORBIDDEN, then any other error (retry). A CONFLICT whose message parses as neither is an error. */
export function failureOutcome(
  err: DecisionError | null | undefined,
  d: Pick<QueueItem, 'id'>,
  viewerRole: string | null,
  t: T,
  locale: 'he' | 'en',
): FailureOutcome {
  const code = err?.data?.code;
  const conflict = code === 'CONFLICT' ? parseDecidedConflict(err?.message) : null;
  const moved = code === 'CONFLICT' ? parseAmountChanged(err?.message) : null;
  if (moved) return { kind: 'amountChanged', nowAgorot: moved.nowAgorot };
  // A colleague escalated this gap to ME while I looked at it: it is still a decision, now mine.
  if (conflict && conflict.status === 'escalated' && viewerRole === 'owner') return { kind: 'escalatedToYou' };
  if (conflict) return { kind: 'elsewhere', text: conflictText(t, conflict, locale), result: resolutionLabel(t, conflict.status) };
  if (code === 'FORBIDDEN') return { kind: 'forbidden' };
  return { kind: 'error' };
}

// ── the reducer ───────────────────────────────────────────────────────────────────────────────

function withIds(set: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> {
  const out = new Set(set);
  for (const id of ids) out.add(id);
  return out;
}

function withoutIds(set: ReadonlySet<string>, ids: Iterable<string>): ReadonlySet<string> {
  const out = new Set(set);
  for (const id of ids) out.delete(id);
  return out;
}

function omitIds<V>(o: Readonly<Record<string, V>>, ids: readonly string[]): Readonly<Record<string, V>> {
  if (!ids.some((id) => Object.prototype.hasOwnProperty.call(o, id))) return o;
  const out: Record<string, V> = { ...o };
  for (const id of ids) delete out[id];
  return out;
}

function patchRow(items: QueueItem[], id: string, patch: Partial<QueueItem>): QueueItem[] {
  return items.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

/** Done rows whose decision has settled and that `keep` does not name → hidden (their undo is gone). */
function hideSettled(s: DeskState, inFlight: ReadonlySet<string>, keep: readonly string[]): Pick<DeskState, 'hidden' | 'done'> {
  const hidden = new Set(s.hidden);
  const done = new Map(s.done);
  for (const id of s.done.keys()) {
    if (keep.includes(id) || inFlight.has(id)) continue;
    hidden.add(id);
    done.delete(id);
  }
  return { hidden, done };
}

/** decide/start and batch/start: the rows turn done at once and leave the totals (optimistic, SPEC §9). */
function markDone(s: DeskState, ids: string[], result: string): Pick<DeskState, 'done' | 'summary'> {
  const done = new Map(s.done);
  let summary = s.summary;
  for (const id of ids) {
    const row = rowOf(s, id);
    if (row) summary = adjustSummary(summary, row, -1);
    done.set(id, { result });
  }
  return { done, summary };
}

/** A rollback: the rows that were done are open again and add back exactly what markDone took. */
function reopenRows(s: DeskState, ids: readonly string[]): Pick<DeskState, 'done' | 'summary'> {
  const done = new Map(s.done);
  let summary = s.summary;
  for (const id of ids) {
    if (!done.has(id)) continue;
    const row = rowOf(s, id);
    if (row) summary = adjustSummary(summary, row, 1);
    done.delete(id);
  }
  return { done, summary };
}

/** decide/ok and batch/ok: the new undo replaces the older one, whose done rows are hidden — unless a NEWER decision's
 *  undo is already up (responses out of order): then these rows' window is gone and they are hidden at once. */
function settleOk(s: DeskState, ids: string[], undo: UndoView, inFlight: ReadonlySet<string>): DeskState {
  if (s.undo && s.undo.sentAt > undo.sentAt) {
    const settled = ids.filter((id) => s.done.has(id));
    const done = new Map(s.done);
    for (const id of settled) done.delete(id);
    return { ...s, inFlight, hidden: withIds(s.hidden, settled), done };
  }
  return { ...s, inFlight, ...hideSettled(s, inFlight, ids), undo };
}

export function deskReducer(s: DeskState, a: DeskAction): DeskState {
  switch (a.type) {
    case 'decide/start': {
      const ids = a.ids.filter((id) => isOpenRow(s, id));
      if (ids.length === 0) return s;
      return {
        ...s,
        ...markDone(s, ids, a.result),
        inFlight: withIds(s.inFlight, ids),
        notes: omitIds(s.notes, ids),
        retry: omitIds(s.retry, ids),
        checked: withoutIds(s.checked, ids),
        asking: null,
        motion: a.how === 'pointer' ? 'next' : null,
      };
    }
    case 'decide/ok':
      return settleOk(s, a.ids, a.undo, withoutIds(s.inFlight, a.ids));
    case 'decide/fail': {
      const { done, summary } = reopenRows(s, a.ids);
      let items = s.items;
      const elsewhere = new Map(s.elsewhere);
      const notes: Record<string, RowNote> = { ...s.notes };
      const retry: Record<string, RetryInfo> = { ...s.retry };
      const o = a.outcome;
      for (const id of a.ids) {
        if (o.kind === 'amountChanged') {
          // The claimable ₪ changed under the decider: show the new figure, decide again.
          items = patchRow(items, id, { claimAgorot: o.nowAgorot });
          notes[id] = { kind: 'amountChanged', amountAgorot: o.nowAgorot };
        } else if (o.kind === 'escalatedToYou') {
          items = patchRow(items, id, { resolutionStatus: 'escalated', requiredRole: 'owner', canAct: true });
          notes[id] = { kind: 'escalatedToYou' };
        } else if (o.kind === 'elsewhere') {
          elsewhere.set(id, { text: o.text, result: o.result });
        } else if (o.kind === 'error') {
          notes[id] = { kind: 'error' };
          if (a.retry) retry[id] = a.retry;
        } else {
          notes[id] = { kind: 'forbidden' };
        }
      }
      return {
        ...s,
        items,
        done,
        summary,
        elsewhere,
        notes,
        retry,
        inFlight: withoutIds(s.inFlight, a.ids),
        hidden: withoutIds(s.hidden, a.ids),
        motion: null,
      };
    }
    case 'batch/start': {
      const ids = a.ids.filter((id) => isOpenRow(s, id));
      if (ids.length === 0) return s;
      return {
        ...s,
        ...markDone(s, ids, a.result),
        inFlight: withIds(s.inFlight, [...ids, BATCH_KEY]),
        notes: omitIds(s.notes, ids),
        retry: omitIds(s.retry, ids),
        checked: a.origin === 'selection' ? new Set() : withoutIds(s.checked, ids),
        batchNote: null,
        asking: null,
        motion: null,
      };
    }
    case 'batch/ok':
      return settleOk(s, a.ids, a.undo, withoutIds(s.inFlight, [...a.ids, BATCH_KEY]));
    case 'batch/fail': {
      const back: DeskState = {
        ...s,
        ...reopenRows(s, a.ids),
        inFlight: withoutIds(s.inFlight, [...a.ids, BATCH_KEY]),
        hidden: withoutIds(s.hidden, a.ids),
      };
      if (a.origin === 'selection') {
        // The selection comes back with the BatchBar's note (decideMany is atomic: nothing was decided).
        return { ...back, checked: new Set(a.ids.filter((id) => isOpenRow(back, id))), batchNote: a.note };
      }
      // "Approve the whole invoice": the note shows in the bar of each gap of the refused group.
      const notes: Record<string, RowNote> = { ...s.notes };
      for (const id of a.ids) notes[id] = { kind: 'batchError', text: a.note };
      return { ...back, notes };
    }
    case 'undo/start':
      if (!s.undo || s.undo.sentAt !== a.sentAt || s.undo.busy) return s;
      return { ...s, undo: { ...s.undo, busy: true } };
    case 'undo/ok': {
      // The undone rows are open again — also when a newer decision's success already hid them.
      const done = new Map(s.done);
      const hidden = new Set(s.hidden);
      let summary = s.summary;
      for (const id of a.ids) {
        if (!done.has(id) && !hidden.has(id)) continue;
        const row = rowOf(s, id);
        if (row) summary = adjustSummary(summary, row, 1);
        done.delete(id);
        hidden.delete(id);
      }
      const undo = s.undo && s.undo.sentAt === a.sentAt ? null : s.undo;
      return { ...s, done, hidden, summary, undo, motion: a.how === 'pointer' ? 'prev' : null };
    }
    case 'undo/fail':
      if (!s.undo || s.undo.sentAt !== a.sentAt) return s;
      return { ...s, undo: { ...s.undo, text: a.text, failed: true, busy: false } };
    case 'undo/expire': {
      if (!s.undo || (a.sentAt !== undefined && s.undo.sentAt !== a.sentAt)) return s;
      return { ...s, ...hideSettled(s, s.inFlight, []), undo: null };
    }
    case 'summary/set':
      return { ...s, summary: a.summary };
    case 'rows/append': {
      // Keyset paging can return a row the client already holds: de-duplicate by id (list.tsx:381-384).
      const seen = new Set(s.items.map((x) => x.id));
      const fresh = a.rows.filter((x) => !seen.has(x.id));
      return { ...s, items: fresh.length > 0 ? [...s.items, ...fresh] : s.items, hasMore: a.hasMore };
    }
    case 'rows/reset': {
      // list.tsx:399-410: the fresh first page replaces everything. A decision still in flight keeps its done mark,
      // so its row never shows as open while the request runs.
      const done = new Map([...s.done].filter(([id]) => s.inFlight.has(id)));
      return {
        ...s,
        items: a.rows,
        hasMore: a.hasMore,
        hidden: new Set(),
        done,
        elsewhere: new Map(),
        checked: new Set(),
      };
    }
    case 'loadMore/busy':
      return s.loadingMore === a.busy ? s : { ...s, loadingMore: a.busy };
    case 'ask/open':
      if (!isOpenRow(s, a.id)) return s;
      return { ...s, asking: { id: a.id, origin: a.origin } };
    case 'ask/close':
      return s.asking ? { ...s, asking: null } : s;
    case 'check/toggle': {
      const row = rowOf(s, a.id);
      // R6 and §5.7: block rows, VAT gaps, rows not mine and rows not open never join a selection.
      if (!row || !isOpenRow(s, a.id) || row.canAct === false || batchRefusalOf(row) != null) return s;
      const checked = new Set(s.checked);
      if (checked.has(a.id)) checked.delete(a.id);
      else checked.add(a.id);
      return { ...s, checked, batchNote: null };
    }
    case 'check/clear':
      if (s.checked.size === 0 && s.batchNote == null) return s;
      return { ...s, checked: new Set(), batchNote: null };
    case 'escalate/open':
      if (!isOpenRow(s, a.id)) return s;
      return { ...s, escalateFor: { id: a.id, origin: a.origin } };
    case 'escalate/close':
      return s.escalateFor ? { ...s, escalateFor: null } : s;
    case 'keys/open':
      return s.keysOpen === a.open ? s : { ...s, keysOpen: a.open };
    case 'elsewhere/hide': {
      if (!s.elsewhere.has(a.id)) return s;
      const elsewhere = new Map(s.elsewhere);
      elsewhere.delete(a.id);
      return { ...s, elsewhere, hidden: withIds(s.hidden, [a.id]) };
    }
    case 'focus/set':
      return s.focus === a.focus ? s : { ...s, focus: a.focus };
    case 'announce':
      return { ...s, announcement: a.text };
    case 'nav':
      return { ...s, asking: null, motion: a.motion, focus: a.focus === undefined ? s.focus : a.focus };
  }
}
