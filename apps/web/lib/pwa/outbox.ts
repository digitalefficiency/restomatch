/**
 * The ONE field outbox (W2-05 slice A · deep-fix class 2 "field work lost").
 *
 * Every piece of field work that must reach the server — a counted line, a
 * receipt close, an invoice photo, a shared dock slip, and later W2-07's stock
 * count — is an item in one IndexedDB store ("restomatch-outbox" / "items").
 * An item leaves the phone ONLY on:
 *   1. a server ack (its kind's `send` resolved), or
 *   2. an explicit delete by the user who captured it (`removeItem`), or
 *   3. 14 days after a visible warning (`markWarned` → `sweepExpired`).
 * Sign-out never wipes it (decision 22: a colleague of the same restaurant
 * uploads it, attributed "צולם על ידי"; another restaurant's items wait for it).
 *
 * A kind is registered once per page with `registerOutboxKind(kind, {send,
 * idempotencyKey, classify})`. The idempotency key is stable per payload
 * identity (e.g. the gr_line id), so a later write of the same thing REPLACES
 * the queued one (latest wins) and a replay sends the same key again.
 *
 * Draining (`drainOutbox`) is oldest first. Items that share a `group` (one
 * receipt) go strictly in order: an item that fails or is not yet due holds
 * the rest of its group, so a close can never overtake its counts. Failures are
 * read by `classifyFailure` (offlineQueue): no network or a 401 costs NO
 * attempt and stops the run; a retryable failure backs off 2/4/8…60 s; a
 * permanent one parks the item (kept, shown, never auto-sent).
 *
 * The core is pure apart from the IndexedDB adapter and the Web Locks guard,
 * so it is unit-tested against `memoryOutboxStore`.
 */
import { ScopeChangedError, classifyFailure, requestPersistentStorage, type FailureKind } from './offlineQueue';

export type OutboxKind = 'grLine' | 'submitReceipt' | 'photo' | 'slipShared' | (string & {});

export type OutboxStatus = 'pending' | 'parked';

export interface OutboxItem<P = unknown> {
  /** `${kind}:${idempotencyKey(payload)}` — the store key; stable across retries and replays. */
  key: string;
  kind: OutboxKind;
  /** Items of one group are sent in order (e.g. `gr:<grId>`: the counts, then the close). */
  group: string | null;
  payload: P;
  /** The restaurant the work was done for: only drained while that restaurant is active. */
  restaurantId: string;
  /** Who captured it (decision 22: a colleague may upload it, attributed). */
  userId: string;
  capturedByName: string | null;
  createdAt: number;
  /** Bumped on every write of the payload: an ack for an older write never removes a newer one. */
  revision: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  status: OutboxStatus;
  /** When the user was shown that this item is stuck; it may be dropped 14 days later. */
  warnedAt: number | null;
  /** Free-form local metadata (e.g. the W1-06 localStorage key the row was mirrored from). */
  meta?: Record<string, string>;
}

/** Storage seam: IndexedDB in the browser, a Map in tests. */
export interface OutboxStore {
  get(key: string): Promise<OutboxItem | undefined>;
  put(item: OutboxItem): Promise<void>;
  list(): Promise<OutboxItem[]>;
  remove(key: string): Promise<void>;
}

export interface OutboxKindDef<P = unknown> {
  /** Send the payload; resolve on the server's ack. Replays must be safe (same key → same effect). */
  send: (payload: P, item: OutboxItem<P>) => Promise<unknown>;
  /** Stable identity of the payload (NOT a random id per write). */
  idempotencyKey: (payload: P) => string;
  /** Items that must go in order share a group. Default: no group. */
  group?: (payload: P) => string | null;
  /** Default: `classifyFailure` (network / auth / retryable / permanent). */
  classify?: (err: unknown) => FailureKind;
}

export interface OutboxScope {
  restaurantId: string;
  userId: string;
}

/** A failure that means "never auto-send this" (e.g. a row counted before the receipt was closed). */
export class OutboxHeldError extends Error {
  constructor(message = 'held') {
    super(message);
    this.name = 'OutboxHeldError';
  }
}

/* ── the kind registry ─────────────────────────────────────────────────── */

const registry = new Map<string, OutboxKindDef<never>>();

/** Register (or re-bind) a kind's sender. Returns the unregister function. */
export function registerOutboxKind<P>(kind: OutboxKind, def: OutboxKindDef<P>): () => void {
  registry.set(kind, def as OutboxKindDef<never>);
  return () => {
    if (registry.get(kind) === (def as OutboxKindDef<never>)) registry.delete(kind);
  };
}

export function getOutboxKind<P = unknown>(kind: OutboxKind): OutboxKindDef<P> | undefined {
  return registry.get(kind) as OutboxKindDef<P> | undefined;
}

/** Tests only. */
export function resetOutboxKinds(): void {
  registry.clear();
}

export function outboxKey(kind: OutboxKind, idempotencyKey: string): string {
  return `${kind}:${idempotencyKey}`;
}

/* ── timing ────────────────────────────────────────────────────────────── */

export const BACKOFF_MAX_MS = 60_000;
/** An item leaves the phone this long after the user was shown it is stuck. */
export const WARNED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** 2, 4, 8, 16, 32, 60, 60… seconds after the 1st, 2nd, 3rd… failed attempt. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, 2_000 * 2 ** (attempts - 1));
}

/* ── writes ────────────────────────────────────────────────────────────── */

export const OUTBOX_EVENT = 'rm-outbox';

export interface OutboxEventDetail {
  /** `drain`: the drainer's own bookkeeping (a drainer never re-triggers itself on it). */
  source: 'write' | 'drain';
}

function announce(source: OutboxEventDetail['source'] = 'write'): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<OutboxEventDetail>(OUTBOX_EVENT, { detail: { source } }));
}

export interface EnqueueMeta {
  restaurantId: string;
  userId: string;
  capturedByName?: string | null;
  meta?: Record<string, string>;
  /** Override the kind's group (e.g. a migrated row). */
  group?: string | null;
}

/**
 * Put a payload in the outbox. Same kind + idempotency key → the queued item is
 * REPLACED (latest wins), keeps its age and author, and becomes due now.
 * The kind must be registered (its key and group come from it) unless
 * `idempotencyKey` is given.
 */
export async function enqueue<P>(
  store: OutboxStore,
  kind: OutboxKind,
  payload: P,
  meta: EnqueueMeta,
  opts: { now?: number; idempotencyKey?: string } = {},
): Promise<OutboxItem<P>> {
  const def = getOutboxKind<P>(kind);
  const idem = opts.idempotencyKey ?? def?.idempotencyKey(payload);
  if (!idem) throw new Error(`outbox kind "${kind}" is not registered`);
  const now = opts.now ?? Date.now();
  const key = outboxKey(kind, idem);
  const prev = (await store.get(key)) as OutboxItem<P> | undefined;
  const item: OutboxItem<P> = {
    key,
    kind,
    group: meta.group !== undefined ? meta.group : (def?.group?.(payload) ?? null),
    payload,
    restaurantId: prev?.restaurantId ?? meta.restaurantId,
    userId: prev?.userId ?? meta.userId,
    capturedByName: prev?.capturedByName ?? meta.capturedByName ?? null,
    createdAt: prev?.createdAt ?? now,
    revision: (prev?.revision ?? 0) + 1,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    status: 'pending',
    warnedAt: null,
    ...(meta.meta || prev?.meta ? { meta: { ...prev?.meta, ...meta.meta } } : {}),
  };
  await store.put(item as OutboxItem);
  void requestPersistentStorage();
  announce();
  return item;
}

/**
 * Explicit delete — only by the user who captured the item ("only the owner
 * deletes them", decision 22). Returns whether it was removed.
 */
export async function removeItem(store: OutboxStore, key: string, by: { userId: string }): Promise<boolean> {
  const item = await store.get(key);
  if (!item || item.userId !== by.userId) return false;
  await store.remove(key);
  announce();
  return true;
}

/** The user was shown these stuck items: start their 14-day clock (once). */
export async function markWarned(store: OutboxStore, keys: string[], now = Date.now()): Promise<void> {
  for (const key of keys) {
    const item = await store.get(key);
    if (item && item.warnedAt === null) await store.put({ ...item, warnedAt: now });
  }
}

/** Drop items whose visible warning is older than 14 days. Returns the dropped keys. */
export async function sweepExpired(store: OutboxStore, now = Date.now()): Promise<string[]> {
  const dropped: string[] = [];
  for (const item of await store.list()) {
    if (item.warnedAt !== null && now - item.warnedAt >= WARNED_RETENTION_MS) {
      await store.remove(item.key);
      dropped.push(item.key);
    }
  }
  if (dropped.length) announce();
  return dropped;
}

/** Re-arm a parked / backing-off item ("try again" in the status sheet). */
export async function retryItem(store: OutboxStore, key: string, now = Date.now()): Promise<void> {
  const item = await store.get(key);
  if (!item) return;
  await store.put({ ...item, status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null });
  announce();
}

/* ── draining ──────────────────────────────────────────────────────────── */

/** Runs `fn` only if no other tab/drainer holds `name`; returns false when skipped. */
export type GroupLock = (name: string, fn: () => Promise<void>) => Promise<boolean>;

const heldInPage = new Set<string>();
/** Groups a screen of THIS page has claimed (whatever the lock backend). */
const claimedHere = new Set<string>();

/** Is this group being worked on by a screen of this page? */
export function claimedInThisPage(group: string | null): boolean {
  return group !== null && claimedHere.has(group);
}

/**
 * Anything a drainer of this page could send now? (Due, not parked, a registered
 * kind, not in a group a screen here holds.) False → no session check, no network.
 */
export function hasSendable(items: OutboxItem[], now = Date.now()): boolean {
  return items.some(
    (i) =>
      i.status === 'pending' &&
      i.nextAttemptAt <= now &&
      registry.has(i.kind) &&
      !claimedInThisPage(i.group),
  );
}

/**
 * Web Locks when the browser has them (cross-tab), an in-page set otherwise.
 * `ifAvailable`: a drainer never waits on a group that a screen (the open
 * wizard) or another tab is working on — it skips it this run.
 */
export const webGroupLock: GroupLock = async (name, fn) => {
  const locks = (typeof navigator === 'undefined' ? undefined : navigator.locks) as LockManager | undefined;
  if (locks?.request) {
    let ran = false;
    await locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      ran = true;
      await fn();
    });
    return ran;
  }
  if (heldInPage.has(name)) return false;
  heldInPage.add(name);
  try {
    await fn();
    return true;
  } finally {
    heldInPage.delete(name);
  }
};

export function groupLockName(item: Pick<OutboxItem, 'group' | 'key'>): string {
  return `rm-outbox:${item.group ?? item.key}`;
}

/**
 * Hold a group's lock for as long as a screen works on it (the wizard holds
 * `gr:<grId>`, so the background drainer never sends its rows twice). Returns
 * the release function.
 */
export function claimOutboxGroup(group: string): () => void {
  const name = `rm-outbox:${group}`;
  let release: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    release = r;
  });
  claimedHere.add(group);
  const locks = (typeof navigator === 'undefined' ? undefined : navigator.locks) as LockManager | undefined;
  if (locks?.request) {
    void locks.request(name, () => done).catch(() => null);
    return () => {
      claimedHere.delete(group);
      release();
    };
  }
  heldInPage.add(name);
  return () => {
    claimedHere.delete(group);
    heldInPage.delete(name);
    release();
  };
}

export interface DrainResult {
  sent: string[];
  failed: string[];
  parked: string[];
  /** Items still on the phone for the active restaurant. */
  remaining: number;
  /** Sent items a colleague captured on this device ("צולם על ידי"). */
  attributed: Array<{ key: string; kind: OutboxKind; capturedByName: string | null }>;
  /** The run stopped because the session is gone (401): sign in to send. */
  authExpired: boolean;
  /** The run stopped because there is no network. */
  offline: boolean;
}

export interface DrainOptions {
  scope: OutboxScope;
  now?: () => number;
  isOnline?: () => boolean;
  lock?: GroupLock;
  /** Only these kinds (default: every registered kind). */
  kinds?: OutboxKind[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : 'error';
}

/**
 * Send every due item of the active restaurant — a colleague's too, attributed —
 * oldest first, groups in order. Unregistered kinds wait (never dropped).
 */
export async function drainOutbox(store: OutboxStore, opts: DrainOptions): Promise<DrainResult> {
  const now = opts.now ?? Date.now;
  const isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const lock = opts.lock ?? webGroupLock;
  const { scope } = opts;
  const out: DrainResult = { sent: [], failed: [], parked: [], remaining: 0, attributed: [], authExpired: false, offline: false };
  const inScope = (i: OutboxItem) => i.restaurantId === scope.restaurantId;
  const wanted = (i: OutboxItem) => !opts.kinds || opts.kinds.includes(i.kind);

  const items = (await store.list()).filter((i) => inScope(i) && wanted(i)).sort((a, b) => a.createdAt - b.createdAt);
  // Group → its items in order. An ungrouped item is its own group.
  const groups = new Map<string, OutboxItem[]>();
  for (const i of items) {
    const g = i.group ?? i.key;
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }

  let stop = false;
  for (const groupItems of groups.values()) {
    if (stop) break;
    if (!isOnline()) {
      out.offline = true;
      break;
    }
    await lock(groupLockName(groupItems[0]!), async () => {
      for (const queued of groupItems) {
        if (!isOnline()) {
          out.offline = true;
          stop = true;
          return;
        }
        const item = await store.get(queued.key); // re-read under the lock (another tab may have sent it)
        if (!item) continue;
        // A parked or not-yet-due item holds the rest of its group: order is the contract.
        if (item.status === 'parked' || item.nextAttemptAt > now()) return;
        const def = getOutboxKind(item.kind);
        if (!def) return; // no sender on this page yet: it waits, and so do the items behind it
        try {
          await def.send(item.payload as never, item as OutboxItem<never>);
          const after = await store.get(item.key);
          // A newer write arrived while this one was in flight: keep it (it is due now).
          if (after && after.revision === item.revision) await store.remove(item.key);
          out.sent.push(item.key);
          if (item.userId !== scope.userId) {
            out.attributed.push({ key: item.key, kind: item.kind, capturedByName: item.capturedByName });
          }
        } catch (err) {
          const kind: FailureKind = err instanceof OutboxHeldError ? 'permanent' : (def.classify ?? classifyFailure)(err);
          const current = (await store.get(item.key)) ?? item;
          // Superseded while in flight: the newer write goes first next run, and keeps its group's order.
          if (current.revision !== item.revision) return;
          if (kind === 'network' || kind === 'auth') {
            // Nothing is wrong with the item: no attempt is spent.
            await store.put({ ...current, lastError: errorText(err) });
            out.failed.push(item.key);
            // A branch switch in another tab is not an expired session: only a missing session asks for a sign-in.
            if (kind === 'auth') out.authExpired ||= !(err instanceof ScopeChangedError);
            else out.offline = true;
            stop = true;
            return;
          }
          if (kind === 'permanent') {
            await store.put({ ...current, status: 'parked', lastError: errorText(err) });
            out.parked.push(item.key);
          } else {
            const attempts = current.attempts + 1;
            await store.put({ ...current, attempts, nextAttemptAt: now() + backoffMs(attempts), lastError: errorText(err) });
            out.failed.push(item.key);
          }
          return; // this group waits behind the failed item
        }
      }
    });
  }
  out.remaining = (await store.list()).filter(inScope).length;
  if (out.sent.length || out.failed.length || out.parked.length) announce('drain');
  return out;
}

/** The earliest moment a pending item of the restaurant becomes due (null: nothing waits on time). */
export function nextDueAt(items: OutboxItem[], scope: Pick<OutboxScope, 'restaurantId'>): number | null {
  let min: number | null = null;
  for (const i of items) {
    if (i.restaurantId !== scope.restaurantId || i.status !== 'pending') continue;
    if (min === null || i.nextAttemptAt < min) min = i.nextAttemptAt;
  }
  return min;
}

export interface OutboxCounts {
  /** This restaurant's items (mine + colleagues'): what the header chip counts. */
  waiting: number;
  mine: number;
  colleagues: number;
  /** Another restaurant's items on this device: kept until it is active. */
  otherBranch: number;
  parked: number;
}

export function countOutbox(items: OutboxItem[], scope: OutboxScope): OutboxCounts {
  const c: OutboxCounts = { waiting: 0, mine: 0, colleagues: 0, otherBranch: 0, parked: 0 };
  for (const i of items) {
    if (i.restaurantId !== scope.restaurantId) {
      c.otherBranch += 1;
      continue;
    }
    c.waiting += 1;
    if (i.userId === scope.userId) c.mine += 1;
    else c.colleagues += 1;
    if (i.status === 'parked') c.parked += 1;
  }
  return c;
}

/* ── adapters ──────────────────────────────────────────────────────────── */

export function memoryOutboxStore(seed: OutboxItem[] = []): OutboxStore & { items: Map<string, OutboxItem> } {
  const items = new Map(seed.map((i) => [i.key, structuredClone(i)]));
  return {
    items,
    async get(key) {
      const i = items.get(key);
      return i ? structuredClone(i) : undefined;
    },
    async put(item) {
      items.set(item.key, structuredClone(item));
    },
    async list() {
      return [...items.values()].map((i) => structuredClone(i));
    },
    async remove(key) {
      items.delete(key);
    },
  };
}

export const OUTBOX_DB = 'restomatch-outbox';
const STORE = 'items';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const idbOutboxStore: OutboxStore = {
  async get(key) {
    return (await run<OutboxItem | undefined>('readonly', (s) => s.get(key) as IDBRequest<OutboxItem | undefined>)) ?? undefined;
  },
  async put(item) {
    await run('readwrite', (s) => s.put(item));
  },
  async list() {
    return (await run<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)) ?? [];
  },
  async remove(key) {
    await run('readwrite', (s) => s.delete(key));
  },
};

/** Only touch IndexedDB if an outbox (or the W1 photo queue) already exists — never create one just to look. */
export async function outboxDbExists(names: string[] = [OUTBOX_DB]): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (!list) return true;
  const have = new Set((await list.call(indexedDB)).map((d) => d.name));
  return names.some((n) => have.has(n));
}
