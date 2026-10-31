'use client';

import { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/components';

/** Seconds of undo for a send and for a supplier switch (R-8). */
export const UNDO_MS = 10_000;

/**
 * A countdown with an undo button: "נשלח לירקות השרון בעוד 8 שנ׳ · בטלו שליחה".
 * `onElapse` fires once when the time runs out (never after undo or unmount —
 * leaving the page inside the window cancels the action, the draft stays).
 * The live region announces the start, not every tick.
 *
 * `autoFocus`: the countdown replaces the button that started it, so focus moves
 * to the undo (keyboard and screen-reader users can reach it at once). The clock
 * pauses while the user moves focus back onto the undo — the first, automatic
 * focus doesn't pause it, or nothing would ever send. (No hover pause: a bar that
 * appears under a resting mouse cursor would then never send.)
 */
export function UndoCountdown({
  deadline,
  message,
  undoLabel,
  onUndo,
  onElapse,
  className,
  testId,
  autoFocus = false,
}: {
  deadline: number;
  message: (seconds: number) => string;
  undoLabel: string;
  onUndo: () => void;
  onElapse?: () => void;
  className?: string;
  testId?: string;
  autoFocus?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  /** The running deadline; null while paused (then `left` holds the remaining ms). */
  const [endAt, setEndAt] = useState<number | null>(deadline);
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  const fired = useRef(false);
  const elapse = useRef(onElapse);
  elapse.current = onElapse;
  const button = useRef<HTMLButtonElement>(null);
  const autoFocused = useRef(false);
  const focusedByUser = useRef(false);

  useEffect(() => {
    fired.current = false;
    setEndAt(deadline);
    setLeft(Math.max(0, deadline - Date.now()));
  }, [deadline]);

  useEffect(() => {
    if (!autoFocus) return;
    autoFocused.current = true;
    button.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (endAt == null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= endAt && !fired.current) {
        fired.current = true;
        elapse.current?.();
      }
    };
    const id = window.setInterval(tick, 250);
    const end = window.setTimeout(tick, Math.max(0, endAt - Date.now()));
    return () => {
      window.clearInterval(id);
      window.clearTimeout(end);
    };
  }, [endAt]);

  const pause = () => {
    if (endAt == null || fired.current) return;
    setLeft(Math.max(0, endAt - Date.now()));
    setEndAt(null);
  };
  const resume = () => {
    if (endAt != null || focusedByUser.current) return;
    setEndAt(Date.now() + Math.max(1000, left));
  };

  const remaining = endAt == null ? left : Math.max(0, endAt - now);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const [first] = useState(() => message(Math.ceil(UNDO_MS / 1000)));
  return (
    <div
      data-testid={testId}
      data-paused={endAt == null || undefined}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink shadow-card',
        className,
      )}
    >
      <p className="sr-only" role="status">
        {first}
      </p>
      <span aria-hidden="true" className="min-w-0 tabular-nums">
        {message(seconds)}
      </span>
      <button
        ref={button}
        type="button"
        onClick={onUndo}
        onFocus={() => {
          if (autoFocused.current) {
            autoFocused.current = false; // the automatic focus: keep counting
            return;
          }
          focusedByUser.current = true;
          pause();
        }}
        onBlur={() => {
          focusedByUser.current = false;
          resume();
        }}
        className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold text-primary hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        {undoLabel}
      </button>
    </div>
  );
}
