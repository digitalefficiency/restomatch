/**
 * The receiving kinds of the field outbox (lib/pwa/outbox.ts) and the bridges
 * from W1-06's stores into it, so nothing captured before this release is lost:
 *
 * - `photo`: the W1 offline invoice-photo queue ("restomatch-receiver" /
 *   "photos") now lives in the outbox. `outboxPhotoStore` is the same
 *   `QueueStore` interface over it (every caller of the photo queue is
 *   unchanged), and `migrateLegacyPhotos` moves the old database's items over,
 *   deleting each old entry only after its copy is written.
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

/** Move the W1 photo database's items into the outbox; each old entry is deleted only after its copy is written. */
export async function migrateLegacyPhotos(store: OutboxStore = idbOutboxStore): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (list && !(await list.call(indexedDB)).some((d) => d.name === LEGACY_PHOTO_DB)) return 0;
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(LEGACY_PHOTO_DB);
    // Opening a database that never existed creates it empty: nothing to move.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db) return 0;
  try {
    if (!db.objectStoreNames.contains(LEGACY_PHOTO_STORE)) return 0;
    const old = await new Promise<QueuedPhoto[]>((resolve, reject) => {
      const r = db.transaction(LEGACY_PHOTO_STORE, 'readonly').objectStore(LEGACY_PHOTO_STORE).getAll();
      r.onsuccess = () => resolve((r.result as QueuedPhoto[]) ?? []);
      r.onerror = () => reject(r.error);
    });
    const view = outboxPhotoStore(store);
    for (const p of old) {
      await view.put(p);
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(LEGACY_PHOTO_STORE, 'readwrite');
        t.objectStore(LEGACY_PHOTO_STORE).delete(p.clientUploadId);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    }
    return old.length;
  } finally {
    db.close();
  }
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
