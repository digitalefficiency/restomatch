/**
 * Delivery Check line outbox: every count mark is saved on change, one
 * goods-receipt line at a time, so a reload, a phone call or a dropped signal
 * never loses field work (RCV-02, mobile-field-02/22).
 *
 * - `set()` debounces per line (300 ms) and then sends the FULL row
 *   (`receiving.markGrLine` overwrites every column it is given).
 * - Writes for one line are chained, so an older value can never land after a
 *   newer one. The latest unacknowledged value per line is kept in storage
 *   (localStorage in the browser) until the server confirms it.
 * - A network failure leaves the line "queued" (saved on the phone, T4) and it
 *   is retried by `retry()` (the wizard calls it on `online` and on a timer);
 *   any other failure is an "error" the receiver can retry on the line.
 *
 * Pure (no React, no DOM besides the optional storage adapter) — unit-tested.
 */

export interface GrLinePayload {
  grLineId: string;
  qtyReceived: number;
  qtyRejected: number;
  rejectReason?: string;
  condition?: 'ok' | 'damaged' | 'rejected';
  conditionNotes?: string;
}

/** saving: waiting for the debounce or in flight · saved: on the server · queued: on the phone, no network · error: rejected. */
export type LineSaveState = 'saving' | 'saved' | 'queued' | 'error';

export interface OutboxStorage {
  load(): GrLinePayload[];
  save(items: GrLinePayload[]): void;
}

export interface LineOutboxOptions {
  send: (payload: GrLinePayload) => Promise<unknown>;
  isNetworkError: (err: unknown) => boolean;
  storage?: OutboxStorage;
  debounceMs?: number;
  onChange?: (states: Readonly<Record<string, LineSaveState>>) => void;
}

export interface FlushResult {
  /** Lines the server rejected (not a network problem). */
  failed: string[];
  /** Lines kept on the phone because there is no network. */
  queued: string[];
}

export interface LineOutbox {
  set(payload: GrLinePayload): void;
  /** Send every unacknowledged line now (no debounce) and wait for all of them. */
  flush(): Promise<FlushResult>;
  /** Re-send queued / failed lines (back online, timer, "retry" on a line). */
  retry(): Promise<FlushResult>;
  /** Lines not yet confirmed by the server (debouncing, in flight, queued or failed). */
  pendingCount(): number;
  /** Payloads not yet confirmed — restored into the marks on resume. */
  pending(): GrLinePayload[];
  states(): Readonly<Record<string, LineSaveState>>;
  dispose(): void;
}

export const LINE_SAVE_DEBOUNCE_MS = 300;

const same = (a: GrLinePayload, b: GrLinePayload) => JSON.stringify(a) === JSON.stringify(b);

export function createLineOutbox(opts: LineOutboxOptions): LineOutbox {
  const debounceMs = opts.debounceMs ?? LINE_SAVE_DEBOUNCE_MS;
  const pending = new Map<string, GrLinePayload>();
  const lastSent = new Map<string, GrLinePayload>();
  const states = new Map<string, LineSaveState>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const chains = new Map<string, Promise<void>>();
  let disposed = false;

  for (const p of opts.storage?.load() ?? []) {
    pending.set(p.grLineId, p);
    states.set(p.grLineId, 'queued');
  }

  const persist = () => opts.storage?.save([...pending.values()]);
  const emit = () => opts.onChange?.(Object.fromEntries(states));

  function setState(id: string, s: LineSaveState) {
    if (states.get(id) === s) return;
    states.set(id, s);
    emit();
  }

  async function sendNow(id: string): Promise<void> {
    const payload = pending.get(id);
    if (!payload || disposed) return;
    setState(id, 'saving');
    try {
      await opts.send(payload);
      lastSent.set(id, payload);
      // A newer value may have arrived while this one was in flight — keep it.
      if (pending.get(id) === payload) {
        pending.delete(id);
        persist();
        setState(id, 'saved');
      }
    } catch (err) {
      if (pending.get(id) !== payload) return; // superseded; the newer write reports
      setState(id, opts.isNetworkError(err) ? 'queued' : 'error');
    }
  }

  /** Writes for one line run one after another, never interleaved. */
  function enqueueSend(id: string): Promise<void> {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    const next = (chains.get(id) ?? Promise.resolve()).then(() => sendNow(id));
    chains.set(id, next);
    return next;
  }

  function collect(ids: string[]): FlushResult {
    return {
      failed: ids.filter((id) => states.get(id) === 'error'),
      queued: ids.filter((id) => states.get(id) === 'queued'),
    };
  }

  return {
    set(payload) {
      if (disposed) return;
      const id = payload.grLineId;
      const last = lastSent.get(id);
      if (!pending.has(id) && last && same(last, payload)) return;
      pending.set(id, payload);
      persist();
      setState(id, 'saving');
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void enqueueSend(id);
        }, debounceMs),
      );
    },
    async flush() {
      const ids = [...pending.keys()];
      await Promise.all(ids.map((id) => enqueueSend(id)));
      return collect(ids);
    },
    async retry() {
      const ids = [...pending.keys()].filter((id) => {
        const s = states.get(id);
        return s === 'queued' || s === 'error';
      });
      await Promise.all(ids.map((id) => enqueueSend(id)));
      return collect(ids);
    },
    pendingCount: () => pending.size,
    pending: () => [...pending.values()],
    states: () => Object.fromEntries(states),
    dispose() {
      disposed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

/** localStorage adapter; private mode / quota errors degrade to memory only. */
export function localStorageOutbox(key: string): OutboxStorage {
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as GrLinePayload[]).filter((p) => typeof p?.grLineId === 'string') : [];
      } catch {
        return [];
      }
    },
    save(items) {
      try {
        if (items.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(items));
      } catch {
        /* storage blocked — the in-memory outbox still sends */
      }
    },
  };
}
