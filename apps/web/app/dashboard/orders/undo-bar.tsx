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
 */
export function UndoCountdown({
  deadline,
  message,
  undoLabel,
  onUndo,
  onElapse,
  className,
  testId,
}: {
  deadline: number;
  message: (seconds: number) => string;
  undoLabel: string;
  onUndo: () => void;
  onElapse?: () => void;
  className?: string;
  testId?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const elapse = useRef(onElapse);
  elapse.current = onElapse;

  useEffect(() => {
    fired.current = false;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline && !fired.current) {
        fired.current = true;
        elapse.current?.();
      }
    };
    const id = window.setInterval(tick, 250);
    const end = window.setTimeout(tick, Math.max(0, deadline - Date.now()));
    return () => {
      window.clearInterval(id);
      window.clearTimeout(end);
    };
  }, [deadline]);

  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const [first] = useState(() => message(Math.ceil(UNDO_MS / 1000)));
  return (
    <div
      data-testid={testId}
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
        type="button"
        onClick={onUndo}
        className="inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-xl px-3 font-semibold text-primary hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Undo2 className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        {undoLabel}
      </button>
    </div>
  );
}
