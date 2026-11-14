'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  isCompleteScope,
  readDraftEnvelope,
  removeDraft,
  writeDraftEnvelope,
  type DraftScope,
} from './store';

const DraftScopeContext = createContext<DraftScope | null>(null);
// Two @types/react copies in the workspace make a raw Context.Provider fail the
// JSX element check (see lib/i18n/client.tsx); cast like the other providers.
const ScopeProvider = DraftScopeContext.Provider as unknown as React.ComponentType<{
  value: DraftScope | null;
  children: React.ReactNode;
}>;

/**
 * Who the drafts below belong to. Mount it once where the session is known
 * (the dashboard shell), or pass `scope` to each hook. Without a complete
 * scope nothing is written to the device: drafts live in React state only,
 * so one person's typing can never be restored into another's session.
 */
export function DraftScopeProvider({ scope, children }: { scope: DraftScope | null; children: React.ReactNode }) {
  return <ScopeProvider value={isCompleteScope(scope) ? scope : null}>{children}</ScopeProvider>;
}

export function useDraftScope(override?: DraftScope | null): DraftScope | null {
  const ctx = useContext(DraftScopeContext);
  const s = override ?? ctx;
  return isCompleteScope(s) ? s : null;
}

export interface FormDraftOptions {
  /** Bump when the draft's shape changes: an older draft is dropped, never restored into the new form. */
  version: string | number;
  /** Drafts older than this are dropped on read (e.g. 7 days for a count). */
  ttlMs?: number;
  /** Overrides `DraftScopeProvider`. */
  scope?: DraftScope | null;
}

export interface FormDraft<T> {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  /** Forget the draft (after a successful save, or "discard"). Resets to `initial`. */
  clear: () => void;
  /** True once a saved draft was put back after a reload. Show "שוחזרה טיוטה". */
  restored: boolean;
  /** When the device copy was last written (ms), or null. */
  savedAt: number | null;
  /** False when there is no scope: the draft is in memory only. */
  persisted: boolean;
  /** False until the device copy has been read (first effect after mount). */
  hydrated: boolean;
}

/**
 * A form value that survives a reload (DoD-7). The server render and the first
 * client render use `initial` (no hydration mismatch); the saved draft is put
 * back in the first effect, and every change after that is written through.
 * Nothing is written before that read, so a reload never overwrites the draft
 * with `initial`.
 */
export function useFormDraft<T>(key: string, initial: T, opts: FormDraftOptions): FormDraft<T> {
  const scope = useDraftScope(opts.scope);
  const scopeId = scope ? `${scope.userId}:${scope.restaurantId}` : '';
  const [value, setValueState] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const ready = useRef(false);

  // Read the device copy once per (scope, key, version).
  useEffect(() => {
    ready.current = false;
    if (scope) {
      const env = readDraftEnvelope<T>(scope, key, { version: opts.version, ttlMs: optsRef.current.ttlMs });
      if (env) {
        setValueState(env.data);
        setSavedAt(env.at);
        setRestored(true);
      } else {
        setRestored(false);
        setSavedAt(null);
      }
    }
    ready.current = true;
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeId stands for scope
  }, [scopeId, key, opts.version]);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (ready.current && scope) setSavedAt(writeDraftEnvelope(scope, key, v, optsRef.current.version).at);
        return v;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeId stands for scope
    [scopeId, key],
  );

  const clear = useCallback(() => {
    if (scope) removeDraft(scope, key);
    setValueState(initialRef.current);
    setRestored(false);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeId stands for scope
  }, [scopeId, key]);

  return { value, setValue, clear, restored, savedAt, persisted: !!scope, hydrated };
}
