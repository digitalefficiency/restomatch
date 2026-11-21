'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Kbd } from '../Kbd';
import { cn } from '../cn';
import { pauseUndoClock, resumeUndoClock, startUndoClock, undoFraction, undoLeftMs, type UndoClock } from './undoTimer';
import { useMediaQuery } from './useMediaQuery';

/**
 * The approvals desk's undo toast (DS3-04 §2.3, §4.6, §5.5). The dark toast with white words and focus ring,
 * "בטלו" beside the decision, and a 2 px line that shows the time left.
 *
 * Timing: visible for `visibleMs` from mount, never past `capAt` (sentAt + the cap). Pointer over it or focus
 * inside it pauses; leaving both resumes with at least 800 ms. The cap wins while paused: a second, never-paused
 * timer expires the toast at `capAt`. A failed reopen shows its text only (no button, no line) for `failedMs`.
 * The line runs on the Web Animations API (linear: time has no token curve); under reduced motion, or without
 * WAAPI, it steps once a second from state — the global reduced-motion rule cannot stop it, because no CSS
 * animation is involved. Not a live region: the desk's announcer speaks the decision.
 */
export interface UndoToastProps {
  text: string; // ≤ 8 words: desk.toast.done "{verb} · {amount} {basis}", the verb alone (no amount, §5.4),
  // desk.toast.batchDone, or undo.failed — built by desk-text toastText() (§2.8)
  undoLabel: string; // t('undo.action') "בטלו"
  capAt: number; // sentAt + UNDO_CAP_MS (epoch ms)
  visibleMs: number; // UNDO_VISIBLE_MS
  failedMs: number; // UNDO_FAILED_MS
  failed: boolean; // text only: no button, no line; closes after failedMs
  busy: boolean; // reopen in flight: the button is disabled (no spinner text change)
  instant: boolean; // decided by key or keyboard: no entry animation
  keyHint: boolean; // single keys on AND placement 'queue': Z cap + aria-keyshortcuts="Z"
  placement: 'queue' | 'bar';
  onUndo: () => void; // the parent re-checks the cap
  onExpire: (info: { hadFocus: boolean }) => void;
}

/** The tick that refreshes `data-undo-left-ms` (both modes) and steps the line under reduced motion. */
const TICK_MS = 1_000;

export function UndoToast({
  text,
  undoLabel,
  capAt,
  visibleMs,
  failedMs,
  failed,
  busy,
  instant,
  keyHint,
  placement,
  onUndo,
  onExpire,
}: UndoToastProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLElement>(null);
  /** Pointer over the toast / focus inside it: either one holds the clock. */
  const hold = useRef({ pointer: false, focus: false });
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)', false);
  const [, setTick] = useState(0);

  const [clock, setClock] = useState<UndoClock>(() => startUndoClock(Date.now(), capAt, visibleMs));
  if (!Object.is(clock.capAt, capAt) || !Object.is(clock.visibleMs, visibleMs)) {
    // A newer decision hands in a new cap: the clock starts again. Adjusted while rendering, so no effect below
    // ever sees the old clock beside the new cap.
    const now = Date.now();
    const fresh = startUndoClock(now, capAt, visibleMs);
    setClock(hold.current.pointer || hold.current.focus ? pauseUndoClock(fresh, now) : fresh);
  }

  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });
  /** One expiry per window: the visible timer, the cap timer and the failed timer may race. */
  const fired = useRef(false);
  const expire = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    const root = rootRef.current;
    onExpireRef.current({ hadFocus: root != null && root.contains(document.activeElement) });
  }, []);

  // A new cap is a new window (before the timers below are armed for it).
  useEffect(() => {
    fired.current = false;
  }, [capAt]);

  // The cap: one timer, never paused (§5.5).
  useEffect(() => {
    if (failed) return;
    const t = window.setTimeout(expire, Math.max(0, capAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [failed, capAt, expire]);

  // The visible window: re-armed on every clock change, idle while paused (the cap timer still runs).
  useEffect(() => {
    if (failed || clock.paused) return;
    const t = window.setTimeout(expire, undoLeftMs(clock, Date.now()));
    return () => window.clearTimeout(t);
  }, [failed, clock, expire]);

  // A failed reopen: the text alone, closed after failedMs.
  useEffect(() => {
    if (!failed) return;
    fired.current = false;
    const t = window.setTimeout(expire, failedMs);
    return () => window.clearTimeout(t);
  }, [failed, failedMs, expire]);

  // Once a second: data-undo-left-ms, and the stepped line under reduced motion.
  useEffect(() => {
    if (failed) return;
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [failed]);

  // The line, motion allowed: scaleX(the fraction left) → scaleX(0) over the time left, rebuilt with the clock.
  useEffect(() => {
    const el = lineRef.current;
    if (failed || reduceMotion || !el || typeof el.animate !== 'function') return;
    const now = Date.now();
    const from = `scaleX(${undoFraction(clock, now)})`;
    const left = undoLeftMs(clock, now);
    let anim: Animation;
    if (!clock.paused) {
      anim = el.animate([{ transform: from }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
    } else {
      // Paused: the line holds — unless the cap comes nearer than the time held, then it runs out at the cap.
      const toCap = Math.max(0, clock.capAt - now);
      const holdUntil = toCap > 0 ? Math.max(0, toCap - left) / toCap : 0;
      anim = el.animate(
        [
          { transform: from, offset: 0 },
          { transform: from, offset: holdUntil },
          { transform: 'scaleX(0)', offset: 1 },
        ],
        { duration: toCap, easing: 'linear', fill: 'forwards' },
      );
    }
    return () => anim.cancel();
  }, [clock, failed, reduceMotion]);

  const syncHold = useCallback(() => {
    const now = Date.now();
    const held = hold.current.pointer || hold.current.focus;
    setClock((c) => (held ? pauseUndoClock(c, now) : resumeUndoClock(c, now)));
  }, []);
  const pause = (kind: 'pointer' | 'focus') => {
    hold.current[kind] = true;
    syncHold();
  };
  const resumeIfIdle = () => {
    hold.current.pointer = false;
    syncHold();
  };
  const resumeIfFocusLeft = (from: HTMLElement, to: EventTarget | null) => {
    if (from.contains(to as Node | null)) return;
    hold.current.focus = false;
    syncHold();
  };

  const left = failed ? 0 : undoLeftMs(clock, Date.now());
  // Drawn from state (whole seconds): the line itself under reduced motion or without WAAPI; with WAAPI the
  // animation paints over it.
  const stepped = visibleMs > 0 ? Math.min(1, Math.max(0, (Math.ceil(left / 1000) * 1000) / visibleMs)) : 0;

  return (
    <div
      ref={rootRef}
      data-testid="approvals-undo"
      data-focus="on-dark"
      data-undo-state={failed ? 'failed' : clock.paused ? 'paused' : 'running'}
      data-undo-left-ms={Math.round(left / 100) * 100}
      onPointerEnter={() => pause('pointer')}
      onPointerLeave={resumeIfIdle}
      onFocus={() => pause('focus')}
      onBlur={(e) => resumeIfFocusLeft(e.currentTarget, e.relatedTarget)}
      className={cn(
        'relative flex items-center justify-between gap-3.5 overflow-hidden rounded-card bg-fg py-2.5 pe-3 ps-3.5 text-body-sm text-on-bold forced-colors:border forced-colors:border-[color:ButtonText]',
        placement === 'queue' ? 'mx-2 mb-2 flex-none shadow-e2' : 'w-full',
        !instant && 'motion-safe:animate-[rm-toast-in_var(--dur-medium)_var(--ease-enter)]',
      )}
    >
      <p className="min-w-0 truncate">{text}</p>
      {!failed ? (
        <button
          type="button"
          data-testid="approvals-undo-button"
          disabled={busy}
          aria-keyshortcuts={keyHint ? 'Z' : undefined}
          onClick={onUndo}
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control px-1 font-medium text-on-bold underline-offset-2 hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
            // One base size per placement, never both: Tailwind emits `.min-h-11` before `.min-h-7` (its value order
            // is lexicographic), so stacked with the plain cn the 28 px floor would win over the bar's 44 px.
            placement === 'bar' ? 'min-h-11 min-w-11' : 'min-h-7 min-w-7',
          )}
        >
          {undoLabel}
          {keyHint ? <Kbd tone="onBold">Z</Kbd> : null}
        </button>
      ) : null}
      {!failed ? (
        <i
          aria-hidden="true"
          data-testid="undo-line"
          ref={lineRef}
          style={{ transform: `scaleX(${stepped})` }}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-on-bold/60 ltr:origin-left rtl:origin-right forced-color-adjust-none forced-colors:bg-[CanvasText]"
        />
      ) : null}
    </div>
  );
}
