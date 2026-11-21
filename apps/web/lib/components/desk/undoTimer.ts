/**
 * The undo toast's clock (DS3-04 §2.3, §5.5; eng.md §7.2). Pure and generic: epoch milliseconds in, a new
 * clock out — no timers, no React. The toast is visible for `visibleMs` from the moment it mounts, a pause
 * (pointer over it, focus inside it) holds the time left, and a resume gives back at least 800 ms. Whatever
 * happens, nothing is offered past `capAt` (sentAt + the cap): the cap wins even while paused.
 */

/** Reference: a paused toast resumes with at least 800 ms. */
export const UNDO_RESUME_MIN_MS = 800;

export interface UndoClock {
  /** When the visible window closes while running (never past capAt). */
  endsAt: number;
  /** The hard cap (epoch ms): no undo after it, paused or not. */
  capAt: number;
  paused: boolean;
  /** Time left when paused (ms); while running it is the left time at the last change. */
  remaining: number;
  visibleMs: number;
}

/** endsAt = min(now + visibleMs, capAt), running. */
export function startUndoClock(now: number, capAt: number, visibleMs: number): UndoClock {
  const endsAt = Math.min(now + visibleMs, capAt);
  return { endsAt, capAt, paused: false, remaining: Math.max(0, endsAt - now), visibleMs };
}

/** Holds the time left (remaining = max(0, endsAt − now)). Pausing a paused clock changes nothing. */
export function pauseUndoClock(c: UndoClock, now: number): UndoClock {
  if (c.paused) return c;
  return { ...c, paused: true, remaining: Math.max(0, c.endsAt - now) };
}

/** Runs again: endsAt = min(now + max(UNDO_RESUME_MIN_MS, remaining), capAt). Resuming a running clock changes nothing. */
export function resumeUndoClock(c: UndoClock, now: number): UndoClock {
  if (!c.paused) return c;
  const endsAt = Math.min(now + Math.max(UNDO_RESUME_MIN_MS, c.remaining), c.capAt);
  return { ...c, paused: false, endsAt, remaining: Math.max(0, endsAt - now) };
}

/** max(0, min(paused ? now + remaining : endsAt, capAt) − now): frozen while paused unless the cap is nearer. */
export function undoLeftMs(c: UndoClock, now: number): number {
  return Math.max(0, Math.min(c.paused ? now + c.remaining : c.endsAt, c.capAt) - now);
}

/** clamp(undoLeftMs / visibleMs, 0, 1): the line's width. */
export function undoFraction(c: UndoClock, now: number): number {
  if (!(c.visibleMs > 0)) return 0;
  return Math.min(1, Math.max(0, undoLeftMs(c, now) / c.visibleMs));
}

export function undoExpired(c: UndoClock, now: number): boolean {
  return undoLeftMs(c, now) <= 0;
}
