'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@/lib/components';

/** How long a reversible money move waits for "undo" before it is written (R-7). */
export const UNDO_MS = 10_000;

export interface PendingCommit {
  id: number;
  /** What the bar says, e.g. "סומן כנשלח · קצביית הכרם". */
  label: string;
  /** The keys the UI shows optimistically (claim ids) until it commits or is undone. */
  keys: string[];
  /** Status the rows show while pending. */
  to: string;
  run: () => Promise<unknown>;
}

/**
 * A reversible move shown at once and written after UNDO_MS unless undone, so
 * no reverse lifecycle edge is ever needed. A pending move is flushed (written
 * now) when the page goes away, so leaving within the window never loses it.
 */
export function useDeferredCommit(opts: { onCommitted?: () => void; onFailed?: () => void } = {}) {
  const [pending, setPending] = useState<PendingCommit[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const live = useRef(new Map<number, PendingCommit>());
  const seq = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const commit = useCallback(async (id: number) => {
    const p = live.current.get(id);
    if (!p) return;
    live.current.delete(id);
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    try {
      await p.run();
      optsRef.current.onCommitted?.();
    } catch {
      optsRef.current.onFailed?.();
    } finally {
      setPending((xs) => xs.filter((x) => x.id !== id));
    }
  }, []);

  const schedule = useCallback(
    (p: Omit<PendingCommit, 'id'>) => {
      const id = ++seq.current;
      const item = { ...p, id };
      live.current.set(id, item);
      timers.current.set(
        id,
        setTimeout(() => void commit(id), UNDO_MS),
      );
      setPending((xs) => [...xs, item]);
      return id;
    },
    [commit],
  );

  const undo = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    live.current.delete(id);
    setPending((xs) => xs.filter((x) => x.id !== id));
  }, []);

  // Leaving the page (or the tab going to the background) writes what is pending now.
  useEffect(() => {
    const flush = () => {
      for (const id of [...live.current.keys()]) void commit(id);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [commit]);

  /** Optimistic status of a key while its move is pending. */
  const pendingTo = useCallback(
    (key: string) => {
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]!.keys.includes(key)) return pending[i]!.to;
      return null;
    },
    [pending],
  );

  return { pending, schedule, undo, commitNow: commit, pendingTo };
}

/** The undo bar: one row per pending move, pinned above the phone's bottom bar. Announced politely. */
export function UndoBar({
  pending,
  onUndo,
  undoLabel,
  countdownLabel,
}: {
  pending: PendingCommit[];
  onUndo: (id: number) => void;
  undoLabel: string;
  /** "{seconds}" placeholder is filled with the seconds left. */
  countdownLabel: (seconds: number) => string;
}) {
  const [, tick] = useState(0);
  const started = useRef(new Map<number, number>());
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending.length]);
  for (const p of pending) if (!started.current.has(p.id)) started.current.set(p.id, Date.now());

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--rm-bottomnav-h,4.5rem)+0.75rem)] z-[70] flex flex-col items-center gap-2 md:bottom-6 print:hidden"
    >
      {pending.map((p) => {
        const left = Math.max(0, Math.ceil((UNDO_MS - (Date.now() - (started.current.get(p.id) ?? Date.now()))) / 1000));
        return (
          <div
            key={p.id}
            role="status"
            data-testid="undo-bar"
            className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border border-line bg-ink px-4 py-2.5 text-sm text-white shadow-card"
          >
            <p className="min-w-0 flex-1">{p.label}</p>
            <span className="shrink-0 text-xs text-white/80 tabular-nums">{countdownLabel(left)}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onUndo(p.id)}
              className="shrink-0"
              data-testid="undo-button"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              {undoLabel}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
