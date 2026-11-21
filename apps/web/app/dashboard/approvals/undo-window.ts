/**
 * The undo window of the approvals desk (DS3-04 §2.2, §5.5).
 *
 * The toast shows for the README's 10 s. The server accepts a reopen while it is younger than its own
 * REOPEN_WINDOW_MS, so the client stops offering it 3 s earlier: the reopen request itself needs that
 * time (uplink, the recovery advisory lock, API↔DB clock skew). A 'use client' file never value-imports
 * @restomatch/api, so the server constant is mirrored here and pinned by __tests__/undo-window.test.ts.
 * Neither window changes in DS3-04 (an owner decision).
 */

/** The visible undo window (README: 10 s). */
export const UNDO_VISIBLE_MS = 10_000;
/** = packages/api/src/routers/approvals.ts REOPEN_WINDOW_MS (pinned by __tests__/undo-window.test.ts). */
export const REOPEN_WINDOW_MS = 15_000;
/** Kept back for the reopen request itself: uplink + the recovery advisory lock + API↔DB skew. */
export const UNDO_SAFETY_MARGIN_MS = 3_000;
/** Hard cap: no undo is offered after sentAt + 12 s, paused or not. */
export const UNDO_CAP_MS = REOPEN_WINDOW_MS - UNDO_SAFETY_MARGIN_MS;
/** A failed reopen shows "כבר אי אפשר לבטל." for this long (list.tsx:339-345 today). */
export const UNDO_FAILED_MS = 5_000;
/** A second activation within this window is ignored (reference), unless the previous decision failed. */
export const DOUBLE_ACTIVATION_MS = 350;
