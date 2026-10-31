'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
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
  /** Per-move failure hook (e.g. the letter that scheduled it shows its own error). */
  onFailed?: () => void;
  /** Epoch ms the move is written at (while running). */
  deadline: number;
  /** ms left while the countdown is held (hover / keyboard focus on the bar), else null. */
  heldLeft: number | null;
}

type NewCommit = Omit<PendingCommit, 'id' | 'deadline' | 'heldLeft'>;

/**
 * A reversible move shown at once and written after UNDO_MS unless undone, so
 * no reverse lifecycle edge is ever needed. A pending move is flushed (written
 * now, one after another) when the page goes away, so leaving within the window
 * never loses it. The countdown holds while the pointer or keyboard focus is on
 * the undo bar (WCAG 2.2.1), and resumes when it leaves.
 */
export function useDeferredCommit(opts: { onCommitted?: () => void; onFailed?: () => void } = {}) {
  const [pending, setPending] = useState<PendingCommit[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const live = useRef(new Map<number, PendingCommit>());
  const seq = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clear = (id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  };

  const commit = useCallback(async (id: number) => {
    const p = live.current.get(id);
    if (!p) return;
    live.current.delete(id);
    clear(id);
    try {
      await p.run();
      optsRef.current.onCommitted?.();
    } catch {
      p.onFailed?.();
      optsRef.current.onFailed?.();
    } finally {
      setPending((xs) => xs.filter((x) => x.id !== id));
    }
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      clear(id);
      timers.current.set(
        id,
        setTimeout(() => void commit(id), ms),
      );
    },
    [commit],
  );

  const schedule = useCallback(
    (p: NewCommit) => {
      const id = ++seq.current;
      const item: PendingCommit = { ...p, id, deadline: Date.now() + UNDO_MS, heldLeft: null };
      live.current.set(id, item);
      arm(id, UNDO_MS);
      setPending((xs) => [...xs, item]);
      return id;
    },
    [arm],
  );

  const undo = useCallback((id: number) => {
    clear(id);
    live.current.delete(id);
    setPending((xs) => xs.filter((x) => x.id !== id));
  }, []);

  /** Hold (true) or resume (false) every running countdown. */
  const hold = useCallback(
    (on: boolean) => {
      const now = Date.now();
      for (const [id, p] of live.current) {
        if (on && p.heldLeft == null) {
          clear(id);
          live.current.set(id, { ...p, heldLeft: Math.max(0, p.deadline - now) });
        } else if (!on && p.heldLeft != null) {
          const left = Math.max(1000, p.heldLeft);
          live.current.set(id, { ...p, deadline: now + left, heldLeft: null });
          arm(id, left);
        }
      }
      setPending((xs) => xs.map((x) => live.current.get(x.id) ?? x));
    },
    [arm],
  );

  // Leaving the page (or the tab going to the background) writes what is pending
  // now — sequentially, so two moves on one claim land in the order they were made.
  useEffect(() => {
    const flush = () => {
      const ids = [...live.current.keys()];
      void ids.reduce<Promise<unknown>>((chain, id) => chain.then(() => commit(id)), Promise.resolve());
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

  return { pending, schedule, undo, hold, commitNow: commit, pendingTo };
}

export type DeferredCommit = ReturnType<typeof useDeferredCommit>;

/**
 * The undo bar: one row per pending move, pinned above the phone's bottom bar.
 * The live region announces each move once (the ticking seconds are hidden from
 * assistive tech). When the move took keyboard focus away (the pressed button
 * went away), focus lands on the newest Undo so it is one key away.
 */
export function UndoBar({
  pending,
  onUndo,
  onHold,
  undoLabel,
  countdownLabel,
}: {
  pending: PendingCommit[];
  onUndo: (id: number) => void;
  onHold?: (on: boolean) => void;
  undoLabel: string;
  /** "{seconds}" placeholder is filled with the seconds left. */
  countdownLabel: (seconds: number) => string;
}) {
  const [, tick] = useState(0);
  const seen = useRef(new Set<number>());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending.length === 0) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending.length]);

  useEffect(() => {
    const fresh = pending.filter((p) => !seen.current.has(p.id));
    for (const p of fresh) seen.current.add(p.id);
    const newest = fresh.at(-1);
    if (!newest) return;
    // After React swaps the pressed button out, focus has fallen to <body>.
    const raf = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) root.current?.querySelector<HTMLButtonElement>(`[data-undo-id="${newest.id}"]`)?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [pending]);

  // Leaving the bar resumes the countdown; a pending hold is released on unmount.
  const holding = useRef(false);
  const setHold = (on: boolean) => {
    if (holding.current === on) return;
    holding.current = on;
    onHold?.(on);
  };
  useEffect(() => {
    if (pending.length === 0) holding.current = false;
  }, [pending.length]);

  return (
    <div
      ref={root}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--rm-bottomnav-h,4.5rem)+0.75rem)] z-[70] flex flex-col items-center gap-2 md:bottom-6 print:hidden"
      onMouseOver={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches?.(':focus-visible')) setHold(true);
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setHold(false);
      }}
    >
      {pending.map((p) => {
        const msLeft = p.heldLeft ?? p.deadline - Date.now();
        const left = Math.max(0, Math.ceil(msLeft / 1000));
        return (
          <div
            key={p.id}
            role="status"
            data-testid="undo-bar"
            className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-xl border border-line bg-ink px-4 py-2.5 text-sm text-on-primary shadow-card"
          >
            <p className="min-w-0 flex-1">{p.label}</p>
            <span aria-hidden="true" className="shrink-0 text-xs tabular-nums opacity-80">
              {countdownLabel(left)}
            </span>
            <Button
              data-undo-id={p.id}
              size="sm"
              variant="secondary"
              onClick={() => {
                onUndo(p.id);
                setHold(false);
              }}
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

const DeferredContext = createContext<DeferredCommit | null>(null);
// Two @types/react copies in the tree: a raw Context.Provider fails the JSX element check (see STATE.md).
const DeferredCtxProvider = DeferredContext.Provider as unknown as React.ComponentType<{
  value: DeferredCommit | null;
  children?: ReactNode;
}>;

/**
 * One deferred-commit queue and ONE undo bar for a whole screen (the claim
 * letters), so several pending moves stack in a single bar instead of several
 * fixed bars drawn on top of each other.
 */
export function DeferredProvider({ children, undoLabel, secondsLabel }: { children: ReactNode; undoLabel: string; secondsLabel: string }) {
  const router = useRouter();
  const deferred = useDeferredCommit({ onCommitted: () => router.refresh() });
  return (
    <DeferredCtxProvider value={deferred}>
      {children}
      <UndoBar
        pending={deferred.pending}
        onUndo={deferred.undo}
        onHold={deferred.hold}
        undoLabel={undoLabel}
        countdownLabel={(n) => secondsLabel.replace('{seconds}', String(n))}
      />
    </DeferredCtxProvider>
  );
}

export function useSharedDeferred(): DeferredCommit {
  const ctx = useContext(DeferredContext);
  if (!ctx) throw new Error('useSharedDeferred needs a <DeferredProvider>');
  return ctx;
}
