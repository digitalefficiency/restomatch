/**
 * The controller behind `useServerDraft`: a value that autosaves to the server
 * (debounced), keeps a device copy until the server has it, and never
 * overwrites someone else's newer save silently.
 *
 * - Edits are written to the device copy at once and saved after `debounceMs`
 *   of quiet. `flush()` saves now (Ctrl/⌘+S, "שמירה", leaving the page).
 * - Offline (navigator says so, or the request fails at the network) → status
 *   `offline`; the device copy stays and `flush()` on reconnect sends it.
 * - The server answers CONFLICT (a tRPC `CONFLICT` error, or `{ conflict }`
 *   from `save`) → status `conflict` with the server's value in `theirs`.
 *   Nothing is retried until the user picks `resolve('mine' | 'theirs')`.
 * - On start, an unsent device copy wins over the server value and is re-sent
 *   (that is the whole point of keeping it).
 *
 * Pure module (no React, no DOM): unit-tested with fake load/save and fake timers.
 */

export type ServerDraftStatus = 'loading' | 'idle' | 'dirty' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

export interface ServerDraftSnapshot<T> {
  status: ServerDraftStatus;
  /** What the user sees and edits. `undefined` only while loading. */
  value: T | undefined;
  /** The server's value when `status === 'conflict'`. */
  theirs: T | undefined;
  /** True when edits exist that the server doesn't have yet. */
  unsaved: boolean;
  lastSavedAt: number | null;
  error: unknown;
}

export interface ServerDraftSaveOptions {
  /** Set by `resolve('mine')`: the caller should overwrite despite a newer server version. */
  force: boolean;
}

/** `save` may report a conflict by returning `{ conflict: serverValue }` or by throwing a tRPC CONFLICT. */
export type ServerDraftSaveResult<T> = void | undefined | { conflict: T };

/** The device copy (the hook binds it to `lib/drafts/store` with the user's scope). */
export interface LocalCopy<T> {
  read(): T | null;
  write(value: T): void;
  remove(): void;
}

export interface ServerDraftConfig<T> {
  load: () => Promise<T>;
  save: (value: T, opts: ServerDraftSaveOptions) => Promise<ServerDraftSaveResult<T>>;
  debounceMs?: number;
  local?: LocalCopy<T> | null;
  isOnline?: () => boolean;
  onChange?: (s: ServerDraftSnapshot<T>) => void;
  now?: () => number;
}

export interface ServerDraftController<T> {
  start(): Promise<void>;
  edit(next: T): void;
  flush(): Promise<void>;
  resolve(choice: 'mine' | 'theirs'): Promise<void>;
  snapshot(): ServerDraftSnapshot<T>;
  dispose(): void;
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const data = (err as { data?: { code?: unknown } | null }).data;
  if (data && typeof data.code === 'string') return data.code;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** A failure at the network (no answer at all), as opposed to an answer that says no. */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError when offline
  const msg = err instanceof Error ? err.message : '';
  return /failed to fetch|networkerror|network request failed|load failed/i.test(msg);
}

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function createServerDraft<T>(cfg: ServerDraftConfig<T>): ServerDraftController<T> {
  const debounceMs = cfg.debounceMs ?? 800;
  const isOnline = cfg.isOnline ?? defaultOnline;
  const now = cfg.now ?? Date.now;
  let s: ServerDraftSnapshot<T> = {
    status: 'loading',
    value: undefined,
    theirs: undefined,
    unsaved: false,
    lastSavedAt: null,
    error: null,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let editSeq = 0;
  let disposed = false;

  const set = (patch: Partial<ServerDraftSnapshot<T>>) => {
    if (disposed) return;
    s = { ...s, ...patch };
    cfg.onChange?.(s);
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void attempt(false);
    }, debounceMs);
  };
  const localRead = (): T | null => {
    try {
      return cfg.local?.read() ?? null;
    } catch {
      return null;
    }
  };
  const localWrite = (v: T) => {
    try {
      cfg.local?.write(v);
    } catch {
      /* the in-memory value still holds it */
    }
  };
  const localRemove = () => {
    try {
      cfg.local?.remove();
    } catch {
      /* nothing to do */
    }
  };

  async function attempt(force: boolean): Promise<void> {
    if (disposed || s.value === undefined) return;
    if (s.status === 'conflict' && !force) return; // waits for the user's choice
    if (inflight) {
      await inflight;
      if (s.unsaved && s.status !== 'conflict') return attempt(force);
      return;
    }
    if (!s.unsaved && !force) return;
    if (!isOnline()) {
      set({ status: 'offline' });
      return;
    }
    const seq = editSeq;
    const value = s.value;
    set({ status: 'saving', error: null });
    inflight = (async () => {
      try {
        const res = await cfg.save(value, { force });
        if (res && typeof res === 'object' && 'conflict' in res) {
          set({ status: 'conflict', theirs: res.conflict });
          return;
        }
        const changedSince = seq !== editSeq;
        if (!changedSince) localRemove();
        set({ status: changedSince ? 'dirty' : 'saved', unsaved: changedSince, lastSavedAt: now() });
        if (changedSince) schedule();
      } catch (err) {
        if (errorCode(err) === 'CONFLICT') {
          let theirs: T | undefined;
          try {
            theirs = await cfg.load();
          } catch {
            theirs = undefined;
          }
          set({ status: 'conflict', theirs, error: err });
        } else if (isNetworkFailure(err) || !isOnline()) {
          set({ status: 'offline', error: err });
        } else {
          set({ status: 'error', error: err });
        }
      }
    })();
    try {
      await inflight;
    } finally {
      inflight = null;
    }
  }

  return {
    async start() {
      const pending = localRead();
      try {
        const server = await cfg.load();
        if (pending !== null) {
          set({ status: 'dirty', value: pending, unsaved: true, error: null });
          void attempt(false);
        } else {
          set({ status: 'idle', value: server, unsaved: false, error: null });
        }
      } catch (err) {
        if (pending !== null) set({ status: 'offline', value: pending, unsaved: true, error: err });
        else set({ status: 'error', error: err });
      }
    },
    edit(next) {
      editSeq++;
      localWrite(next);
      const keepConflict = s.status === 'conflict';
      set({ value: next, unsaved: true, status: keepConflict ? 'conflict' : 'dirty' });
      if (!keepConflict) schedule();
    },
    async flush() {
      cancelTimer();
      await attempt(false);
    },
    async resolve(choice) {
      if (s.status !== 'conflict') return;
      cancelTimer();
      if (choice === 'theirs') {
        let theirs = s.theirs;
        if (theirs === undefined) {
          try {
            theirs = await cfg.load();
          } catch (err) {
            set({ error: err }); // still in conflict: nothing is thrown away blind
            return;
          }
        }
        localRemove();
        editSeq++;
        set({ status: 'idle', value: theirs, theirs: undefined, unsaved: false, error: null });
        return;
      }
      set({ status: 'dirty', theirs: undefined, unsaved: true });
      await attempt(true);
    },
    snapshot: () => s,
    dispose() {
      cancelTimer();
      disposed = true;
    },
  };
}
