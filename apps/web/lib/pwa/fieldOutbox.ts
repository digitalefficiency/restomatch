/**
 * The receiving kinds of the field outbox (lib/pwa/outbox.ts) and the bridges
 * from W1-06's stores into it, so nothing captured before this release is lost:
 *
 * - `photo`: the W1 offline invoice-photo queue ("restomatch-receiver" /
 *   "photos") now lives in the outbox. `outboxPhotoStore` is the same
 *   `QueueStore` interface over it (every caller of the photo queue is
 *   unchanged). `migrateLegacyPhotos` COPIES the old database's items forward
 *   and deletes none; the outbox mirrors every photo write and delete back into
 *   the old store (`legacyPhotoMirror`), so it always holds exactly the unsent
 *   photos and a rolled-back W1 build still uploads them (rollback safety).
 * - `grLine`: the Delivery Check keeps its per-line engine (lineOutbox: 300 ms
 *   debounce, ordered writes, held rows) and its synchronous localStorage copy
 *   `rm-rcv-lines:<userId>:<poId>` for an instant resume; `fieldLineStorage`
 *   mirrors every unsent row into the outbox, so the background drainer sends
 *   it even after the receiver left the screen. `migrateLegacyLines` mirrors
 *   rows written before this release. The localStorage row goes only when the
 *   server acked it (`dropLegacyLine`).
 * - `submitReceipt` and `slipShared`: keys and groups are defined here; their
 *   senders bind in slice B/C (`clientMutationId` on submit, `receiving.slipShared`).
 *   Until a kind is bound its items wait — they are never dropped.
 *
 * `rm-rcv-unordered:*` (marks on invoice-only lines) is not server work — it has
 * no row to save to until the close — so it stays the wizard's local state.
 */
import type { GrLinePayload, OutboxStorage } from './lineOutbox';
import { localStorageOutbox } from './lineOutbox';
import type { QueueStore, QueuedPhoto } from './offlineQueue';
import {
  OUTBOX_DB,
  OUTBOX_EVENT,
  enqueue,
  registerStoreMirror,
  type StoreMirror,
  idbOutboxStore,
  outboxKey,
  type OutboxItem,
  type OutboxKindDef,
  type OutboxStore,
} from './outbox';

/* ── kind identities (no senders) ──────────────────────────────────────── */

export interface SubmitReceiptPayload {
  grId: string;
  /** The close's idempotency key (slice B: `withIdempotency` on the server). */
  clientMutationId: string;
  invoiceIds?: string[];
  closeAs?: 'partial';
}

export interface SlipSharedPayload {
  grId: string;
  channel: 'whatsapp' | 'print' | 'copy' | 'share';
  clientMutationId: string;
}

export type FieldKindIdentity<P> = Pick<OutboxKindDef<P>, 'idempotencyKey' | 'group'>;

/** One receipt's work goes in order: its counts, then its close, then its slip. */
export const receiptGroup = (grId: string) => `gr:${grId}`;

export const GR_LINE_KIND: FieldKindIdentity<GrLinePayload> = {
  idempotencyKey: (p) => p.grLineId,
  group: (p) => (p.stamp ? receiptGroup(p.stamp.grId) : null),
};
export const SUBMIT_RECEIPT_KIND: FieldKindIdentity<SubmitReceiptPayload> = {
  idempotencyKey: (p) => p.grId,
  group: (p) => receiptGroup(p.grId),
};
export const PHOTO_KIND: FieldKindIdentity<QueuedPhoto> = {
  idempotencyKey: (p) => p.clientUploadId,
  group: () => null,
};
export const SLIP_SHARED_KIND: FieldKindIdentity<SlipSharedPayload> = {
  idempotencyKey: (p) => p.clientMutationId,
  group: (p) => receiptGroup(p.grId),
};

/* ── photo: the W1 queue as a view over the outbox ─────────────────────── */

const LEGACY_PHOTO_DB = 'restomatch-receiver';
const LEGACY_PHOTO_STORE = 'photos';

function photoItem(p: QueuedPhoto, prev: OutboxItem | undefined): OutboxItem<QueuedPhoto> {
  const { attempts, lastError, ...payload } = p;
  return {
    key: outboxKey('photo', p.clientUploadId),
    kind: 'photo',
    group: null,
    payload: { ...payload, attempts: 0, lastError: null },
    restaurantId: p.restaurantId,
    userId: p.userId,
    capturedByName: p.capturedByName ?? null,
    createdAt: p.createdAt,
    revision: (prev?.revision ?? 0) + 1,
    attempts,
    nextAttemptAt: prev?.nextAttemptAt ?? p.createdAt,
    lastError,
    status: prev?.status ?? 'pending',
    warnedAt: prev?.warnedAt ?? null,
  };
}

function asPhoto(i: OutboxItem): QueuedPhoto {
  return { ...(i.payload as QueuedPhoto), attempts: i.attempts, lastError: i.lastError };
}

/** The photo queue's `QueueStore`, kept in the outbox (kind `photo`). */
export function outboxPhotoStore(store: OutboxStore = idbOutboxStore, ready: () => Promise<void> = () => Promise.resolve()): QueueStore {
  return {
    async put(item) {
      await ready();
      const key = outboxKey('photo', item.clientUploadId);
      await store.put(photoItem(item, await store.get(key)) as OutboxItem);
    },
    async list() {
      await ready();
      return (await store.list()).filter((i) => i.kind === 'photo').map(asPhoto);
    },
    async remove(id) {
      await ready();
      await store.remove(outboxKey('photo', id));
    },
  };
}

/* ── rollback safety: the W1 photo queue stays true ─────────────────────── */

/**
 * The W1 photo queue ("restomatch-receiver" / "photos", keyPath clientUploadId,
 * the QueuedPhoto shape) as a store. The outbox MIRRORS every photo write and
 * delete into it, so it always holds exactly the photos not yet sent: a rolled-back
 * W1 build still finds and uploads them, and never one this build already sent.
 */
export interface LegacyPhotoStore {
  list(): Promise<QueuedPhoto[]>;
  put(p: QueuedPhoto): Promise<void>;
  remove(clientUploadId: string): Promise<void>;
}

async function legacyDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (!list) return true;
  return (await list.call(indexedDB)).some((d) => d.name === LEGACY_PHOTO_DB);
}

/** Open the W1 database with W1's own schema (version 1, store "photos"), creating it only when asked. */
function openLegacy(create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(LEGACY_PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      if (!create) {
        req.transaction?.abort(); // never create it just to look
        return;
      }
      if (!req.result.objectStoreNames.contains(LEGACY_PHOTO_STORE)) {
        req.result.createObjectStore(LEGACY_PHOTO_STORE, { keyPath: 'clientUploadId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function legacyTx<T>(create: boolean, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  if (!create && !(await legacyDbExists())) return undefined;
  const db = await openLegacy(create);
  if (!db) return undefined;
  try {
    if (!db.objectStoreNames.contains(LEGACY_PHOTO_STORE)) return undefined;
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(LEGACY_PHOTO_STORE, mode);
      const r = fn(t.objectStore(LEGACY_PHOTO_STORE));
      t.oncomplete = () => resolve(r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const idbLegacyPhotoStore: LegacyPhotoStore = {
  async list() {
    return ((await legacyTx<QueuedPhoto[]>(false, 'readonly', (s) => s.getAll() as IDBRequest<QueuedPhoto[]>)) ?? []) as QueuedPhoto[];
  },
  async put(p) {
    // A photo captured by this build is written where a W1 build would look too.
    await legacyTx(true, 'readwrite', (s) => void s.put(p));
  },
  async remove(id) {
    await legacyTx(false, 'readwrite', (s) => void s.delete(id));
  },
};

/** The outbox → W1 queue mirror: photo puts and deletes only. */
export function legacyPhotoMirror(legacy: LegacyPhotoStore): StoreMirror {
  return {
    async onPut(item) {
      if (item.kind === 'photo') await legacy.put(asPhoto(item));
    },
    async onRemove(key) {
      if (key.startsWith('photo:')) await legacy.remove(key.slice('photo:'.length));
    },
  };
}

if (typeof indexedDB !== 'undefined') registerStoreMirror(legacyPhotoMirror(idbLegacyPhotoStore));

/**
 * Copy the W1 queue's photos into the outbox, forward only: NOTHING is deleted
 * from the W1 queue here. An entry leaves it only when the outbox sends or
 * deletes that photo (the mirror), so a rollback at any point loses nothing.
 */
export async function migrateLegacyPhotos(
  store: OutboxStore = idbOutboxStore,
  legacy: LegacyPhotoStore = idbLegacyPhotoStore,
): Promise<number> {
  let copied = 0;
  for (const p of await legacy.list()) {
    const key = outboxKey('photo', p.clientUploadId);
    if (await store.get(key)) continue; // already in the outbox: it is the newer copy
    await store.put(photoItem(p, undefined) as OutboxItem);
    copied += 1;
  }
  return copied;
}

/* ── grLine: W1-06's localStorage rows, mirrored ───────────────────────── */

export const LEGACY_LINES_PREFIX = 'rm-rcv-lines:';

export interface MirrorScope {
  restaurantId: string;
  userId: string;
  capturedByName?: string | null;
}

/** `rm-rcv-lines:<userId>:<poId>` → its user (the key's first segment). */
export function legacyLineKeyUser(key: string): string | null {
  if (!key.startsWith(LEGACY_LINES_PREFIX)) return null;
  const user = key.slice(LEGACY_LINES_PREFIX.length).split(':')[0];
  return user && user !== '-' ? user : null;
}

async function mirrorRows(store: OutboxStore, legacyKey: string, rows: GrLinePayload[], scope: MirrorScope): Promise<void> {
  const keep = new Set(rows.map((r) => outboxKey('grLine', r.grLineId)));
  for (const row of rows) {
    const key = outboxKey('grLine', row.grLineId);
    const prev = (await store.get(key)) as OutboxItem<GrLinePayload> | undefined;
    if (prev && JSON.stringify(prev.payload) === JSON.stringify(row)) continue; // unchanged: keep its backoff
    await enqueue(store, 'grLine', row, {
      restaurantId: scope.restaurantId,
      userId: scope.userId,
      capturedByName: scope.capturedByName ?? null,
      group: GR_LINE_KIND.group!(row),
      meta: { legacyKey },
    }, { idempotencyKey: GR_LINE_KIND.idempotencyKey(row) });
  }
  // Rows this screen no longer holds were acked (or discarded / the receipt closed): drop their mirror.
  for (const item of await store.list()) {
    if (item.kind === 'grLine' && item.meta?.legacyKey === legacyKey && !keep.has(item.key)) await store.remove(item.key);
  }
}

/**
 * The Delivery Check's line storage: the synchronous localStorage copy (instant
 * resume) plus a mirror into the outbox (sent by the background drainer once
 * the screen is gone). Mirror writes are serialised per key.
 */
export function fieldLineStorage(legacyKey: string, scope: MirrorScope | null, store: OutboxStore = idbOutboxStore): OutboxStorage {
  const local = localStorageOutbox(legacyKey);
  let chain: Promise<void> = Promise.resolve();
  return {
    load: () => local.load(),
    save(items) {
      local.save(items);
      if (!scope || (store === idbOutboxStore && typeof indexedDB === 'undefined')) return;
      const rows = items.map((r) => ({ ...r }));
      chain = chain.then(() => mirrorRows(store, legacyKey, rows, scope)).catch(() => undefined);
    },
  };
}

function readLegacy(key: string): GrLinePayload[] {
  return localStorageOutbox(key).load();
}

/**
 * Mirror every W1-06 line row on this device into the outbox (zero loss: the
 * localStorage copy stays until the server acks the row). A row is attributed
 * to the user in its key; its restaurant is the active one (the row's gr_line
 * id is tenant-checked by the server, so a row of another branch is refused
 * and parked, never applied elsewhere).
 */
export async function migrateLegacyLines(scope: MirrorScope, store: OutboxStore = idbOutboxStore): Promise<number> {
  if (typeof window === 'undefined') return 0;
  let n = 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(LEGACY_LINES_PREFIX)) keys.push(k);
    }
  } catch {
    return 0;
  }
  for (const k of keys) {
    const rows = readLegacy(k);
    if (rows.length === 0) continue;
    const userId = legacyLineKeyUser(k) ?? scope.userId;
    for (const row of rows) {
      const key = outboxKey('grLine', row.grLineId);
      if (await store.get(key)) continue; // already mirrored (a newer write wins)
      await enqueue(store, 'grLine', row, {
        restaurantId: scope.restaurantId,
        userId,
        capturedByName: userId === scope.userId ? (scope.capturedByName ?? null) : null,
        group: GR_LINE_KIND.group!(row),
        meta: { legacyKey: k },
      }, { idempotencyKey: GR_LINE_KIND.idempotencyKey(row) });
      n += 1;
    }
  }
  return n;
}

/** Is any W1-06 localStorage row on this device not yet in the outbox (needs `migrateLegacyLines`)? */
export async function hasUnmirroredLegacyLines(store: OutboxStore = idbOutboxStore): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(LEGACY_LINES_PREFIX)) keys.push(k);
    }
  } catch {
    return false;
  }
  for (const k of keys) {
    for (const row of readLegacy(k)) if (!(await store.get(outboxKey('grLine', row.grLineId)))) return true;
  }
  return false;
}

/** The server acked a mirrored row: drop it from the W1-06 localStorage copy too (unless a newer value replaced it). */
export function dropLegacyLine(legacyKey: string | undefined, sent: GrLinePayload): void {
  if (!legacyKey || typeof window === 'undefined') return;
  const local = localStorageOutbox(legacyKey);
  const rows = local.load();
  const next = rows.filter((r) => !(r.grLineId === sent.grLineId && JSON.stringify(r) === JSON.stringify(sent)));
  if (next.length !== rows.length) local.save(next);
}

/** Every database name the field outbox may have data in (for the "does anything exist" check). */
export const FIELD_DB_NAMES = [OUTBOX_DB, LEGACY_PHOTO_DB];

let migrating: Promise<void> | null = null;

/**
 * Before each read of the photo queue: move in whatever the W1 database holds
 * (an older tab may still write there). Cheap when it is empty or absent.
 */
export function ensurePhotosMigrated(store: OutboxStore = idbOutboxStore): Promise<void> {
  migrating ??= migrateLegacyPhotos(store)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      migrating = null;
    });
  return migrating;
}

/** This user's items on the device (any branch, any kind) — the sign-out guard names this count. */
export async function countMineOnDevice(userId: string, store: OutboxStore = idbOutboxStore): Promise<{ total: number; photos: number }> {
  await ensurePhotosMigrated(store);
  const mine = (await store.list()).filter((i) => i.userId === userId);
  return { total: mine.length, photos: mine.filter((i) => i.kind === 'photo').length };
}

/** The explicit "delete and sign out" choice: ONLY this user's items, every kind (and their W1-06 line copies). */
export async function clearMineOnDevice(userId: string, store: OutboxStore = idbOutboxStore): Promise<void> {
  for (const i of await store.list()) {
    if (i.userId !== userId) continue;
    await store.remove(i.key);
    if (i.kind === 'grLine') dropLegacyLine(i.meta?.legacyKey, i.payload as GrLinePayload);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('rm-receiver-queue'));
    window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { source: 'write' } }));
  }
}
