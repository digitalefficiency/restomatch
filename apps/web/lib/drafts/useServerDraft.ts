'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createServerDraft,
  type ServerDraftController,
  type ServerDraftSaveOptions,
  type ServerDraftSaveResult,
  type ServerDraftSnapshot,
} from './serverDraft';
import { readDraftEnvelope, removeDraft, writeDraftEnvelope, type DraftScope } from './store';
import { useDraftScope } from './useFormDraft';

export interface ServerDraftOptions<T> {
  load: () => Promise<T>;
  save: (value: T, opts: ServerDraftSaveOptions) => Promise<ServerDraftSaveResult<T>>;
  debounceMs?: number;
  /** Version of the device copy's shape; a mismatch drops it. */
  version: string | number;
  /** Device-copy key (scoped by user + restaurant). Omit for no device copy. */
  key?: string;
  ttlMs?: number;
  scope?: DraftScope | null;
}

export interface ServerDraft<T> extends ServerDraftSnapshot<T> {
  setValue: (next: T) => void;
  /** Save now (Ctrl/⌘+S, a "שמירה" button, before leaving). */
  flush: () => Promise<void>;
  /** After a CONFLICT: keep my edits (overwrite) or take the server's. */
  resolve: (choice: 'mine' | 'theirs') => Promise<void>;
}

/**
 * A server-backed draft with debounced autosave. A CONFLICT from the server
 * is surfaced as `status: 'conflict'` (+ `theirs`) — never a silent
 * overwrite; offline keeps the device copy and sends it on reconnect.
 * Pair with `useLeaveGuard(draft.unsaved, …)` and `useSaveShortcut(draft.flush)`.
 */
export function useServerDraft<T>(opts: ServerDraftOptions<T>): ServerDraft<T> {
  const scope = useDraftScope(opts.scope);
  const scopeId = scope ? `${scope.userId}:${scope.restaurantId}` : '';
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [snap, setSnap] = useState<ServerDraftSnapshot<T>>({
    status: 'loading',
    value: undefined,
    theirs: undefined,
    unsaved: false,
    lastSavedAt: null,
    error: null,
  });

  // The controller is created inside the effect (not in render), so React's
  // dev double-mount gets a fresh one instead of a disposed one.
  const ctrl = useRef<ServerDraftController<T> | null>(null);

  useEffect(() => {
    const { key, version, ttlMs } = optsRef.current;
    const local =
      scope && key
        ? {
            read: () => readDraftEnvelope<T>(scope, key, { version, ttlMs })?.data ?? null,
            write: (v: T) => void writeDraftEnvelope(scope, key, v, version),
            remove: () => removeDraft(scope, key),
          }
        : null;
    const c = createServerDraft<T>({
      load: () => optsRef.current.load(),
      save: (v, o) => optsRef.current.save(v, o),
      debounceMs: optsRef.current.debounceMs,
      local,
      onChange: setSnap,
    });
    ctrl.current = c;
    void c.start();
    const online = () => void c.flush();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      c.dispose();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeId stands for scope
  }, [scopeId, opts.key, opts.version]);

  const setValue = useCallback((next: T) => ctrl.current?.edit(next), []);
  const flush = useCallback(async () => {
    await ctrl.current?.flush();
  }, []);
  const resolve = useCallback(async (choice: 'mine' | 'theirs') => {
    await ctrl.current?.resolve(choice);
  }, []);

  return { ...snap, setValue, flush, resolve };
}
