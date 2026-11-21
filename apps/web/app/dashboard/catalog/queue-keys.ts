/**
 * W3-10 · the "לקשר" split view's keyboard. Pure reducer so the page, the
 * phone bottom sheet and the tests share one definition.
 *
 *   1 / 2 / 3  link the focused row to candidate product 1–3
 *   4          create a new product from the row
 *   J / K      next / previous row (also ArrowDown / ArrowUp)
 *   Z          undo the last link or create (one step, server-side via audit)
 *
 * Hebrew keyboard layout: the same physical keys type ח / ל / ז, so those are
 * accepted too (a manager on a Hebrew layout must not have to switch).
 * Modifier chords (Ctrl/⌘/Alt) are never ours: the browser and the palette own them.
 */

export type QueueEffect =
  | { kind: 'link'; rowIndex: number; candidate: 0 | 1 | 2 }
  | { kind: 'create'; rowIndex: number }
  | { kind: 'undo'; action: QueueAction }
  | { kind: 'none' };

export type QueueAction = { kind: 'link' | 'create'; rowIndex: number };

export interface QueueState {
  /** Focused row; -1 when the queue is empty. */
  index: number;
  rowCount: number;
  /** Candidates offered for the focused row (0–3). */
  candidateCount: number;
  history: QueueAction[];
}

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when focus is in a text field: keys type, they don't act. */
  inEditable?: boolean;
}

const NEXT = new Set(['j', 'J', 'ח', 'ArrowDown']);
const PREV = new Set(['k', 'K', 'ל', 'ArrowUp']);
const UNDO = new Set(['z', 'Z', 'ז']);
const HISTORY_CAP = 20;

export function initialQueueState(rowCount: number, candidateCount = 0): QueueState {
  return { index: rowCount > 0 ? 0 : -1, rowCount, candidateCount, history: [] };
}

/** After a link/create the row leaves the queue; focus stays on the same slot (the next row slides in). */
function afterResolve(s: QueueState, action: QueueAction): QueueState {
  const rowCount = Math.max(0, s.rowCount - 1);
  const index = rowCount === 0 ? -1 : Math.min(s.index, rowCount - 1);
  return { ...s, rowCount, index, history: [...s.history, action].slice(-HISTORY_CAP) };
}

export function reduceQueueKey(s: QueueState, e: KeyInput): { state: QueueState; effect: QueueEffect; handled: boolean } {
  const none = { state: s, effect: { kind: 'none' } as QueueEffect, handled: false };
  if (e.inEditable || e.ctrlKey || e.metaKey || e.altKey) return none;

  if (NEXT.has(e.key) || PREV.has(e.key)) {
    if (s.rowCount === 0) return { ...none, handled: true };
    const step = NEXT.has(e.key) ? 1 : -1;
    const index = Math.min(s.rowCount - 1, Math.max(0, s.index + step));
    return { state: { ...s, index }, effect: { kind: 'none' }, handled: true };
  }
  if (UNDO.has(e.key)) {
    const action = s.history[s.history.length - 1];
    if (!action) return { ...none, handled: true };
    const rowCount = s.rowCount + 1;
    return {
      state: { ...s, rowCount, index: Math.min(action.rowIndex, rowCount - 1), history: s.history.slice(0, -1) },
      effect: { kind: 'undo', action },
      handled: true,
    };
  }
  if (s.index < 0) return none;
  if (e.key === '1' || e.key === '2' || e.key === '3') {
    const candidate = (Number(e.key) - 1) as 0 | 1 | 2;
    if (candidate >= s.candidateCount) return { ...none, handled: true };
    const action: QueueAction = { kind: 'link', rowIndex: s.index };
    return { state: afterResolve(s, action), effect: { kind: 'link', rowIndex: s.index, candidate }, handled: true };
  }
  if (e.key === '4') {
    const action: QueueAction = { kind: 'create', rowIndex: s.index };
    return { state: afterResolve(s, action), effect: { kind: 'create', rowIndex: s.index }, handled: true };
  }
  return none;
}
