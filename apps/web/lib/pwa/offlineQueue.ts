/**
 * Receiver PWA offline photo queue (flag `receiverPwa`).
 *
 * A photo taken while offline is stored in IndexedDB (database
 * "restomatch-receiver", store "photos", key = clientUploadId) together with
 * the PO it belongs to. When the device is back online the queue uploads it
 * through the NORMAL authenticated path — scans.upload → receiving.startReceipt
 * → receiving.registerInvoice — re-using the same clientUploadId (M8), so a
 * retry after a half-finished attempt maps to the same scan object and the same
 * invoice: never a duplicate upload, invoice or OCR job.
 *
 * Only these fields are kept, only on this device, and the entry is deleted as
 * soon as the invoice is registered.
 */
export interface QueuedPhoto {
  clientUploadId: string;
  /** The restaurant the photo was taken for — only uploaded while that restaurant is active. */
  restaurantId: string;
  /** The signed-in user who took it — never uploaded under another user (shared tablet). */
  userId: string;
  poId: string;
  supplierId: string;
  supplierName: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}

/** Storage seam (IndexedDB in the browser, a Map in tests). */
export interface QueueStore {
  put(item: QueuedPhoto): Promise<void>;
  list(): Promise<QueuedPhoto[]>;
  remove(clientUploadId: string): Promise<void>;
}

export type PhotoUploader = (item: QueuedPhoto) => Promise<{ invoiceId: string }>;

export interface ProcessResult {
  uploaded: string[];
  failed: string[];
  remaining: number;
}

/** After this many failed attempts an item stays queued but is no longer auto-retried in a loop. */
export const MAX_AUTO_ATTEMPTS = 8;

/**
 * Upload every queued photo, oldest first. One at a time (a phone on a weak
 * connection), stopping at the first network error — the rest wait for the
 * next `online` event. Items are removed ONLY after the invoice is registered.
 */
export async function processQueue(
  store: QueueStore,
  upload: PhotoUploader,
  isOnline: () => boolean = () => true,
  scope?: { restaurantId: string; userId: string },
): Promise<ProcessResult> {
  // Another restaurant's / user's photos (shared device, restaurant switch) are
  // never uploaded under the current session; they wait for their owner.
  const mine = (i: QueuedPhoto) => !scope || (i.restaurantId === scope.restaurantId && i.userId === scope.userId);
  const items = (await store.list())
    .filter(mine)
    .sort((a, b) => a.createdAt - b.createdAt);
  const uploaded: string[] = [];
  const failed: string[] = [];
  for (const item of items) {
    if (!isOnline()) break;
    if (item.attempts >= MAX_AUTO_ATTEMPTS) continue;
    try {
      await upload(item);
      await store.remove(item.clientUploadId);
      uploaded.push(item.clientUploadId);
    } catch (err) {
      failed.push(item.clientUploadId);
      await store.put({
        ...item,
        attempts: item.attempts + 1,
        lastError: err instanceof Error ? err.message.slice(0, 300) : 'error',
      });
      if (isNetworkError(err)) break;
    }
  }
  const left = await store.list();
  return { uploaded, failed, remaining: left.filter(mine).length };
}

/** fetch() rejects with a TypeError when the network is unreachable. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /TypeError|Failed to fetch|NetworkError|Load failed|network/i.test(msg);
}

/* ── IndexedDB adapter ───────────────────────────────────────────────────── */

const DB_NAME = 'restomatch-receiver';
const STORE = 'photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'clientUploadId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(r.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export const idbQueueStore: QueueStore = {
  async put(item) {
    await tx('readwrite', (s) => s.put(item));
  },
  async list() {
    return (await tx<QueuedPhoto[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedPhoto[]>)) ?? [];
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
  },
};

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Change event so every mounted banner/hook refreshes its count. */
export const QUEUE_EVENT = 'rm-receiver-queue';

/**
 * Fired by the PWA shell for each queued photo it uploaded and registered, so
 * an open receiving wizard that captured it offline can resume (stop showing
 * "saved on the phone", poll the now-registered invoice).
 */
export const SYNCED_EVENT = 'rm-receiver-synced';
export interface SyncedPhotoDetail {
  clientUploadId: string;
  poId: string;
  grId: string;
  invoiceId: string;
}

export function announceSynced(detail: SyncedPhotoDetail): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SyncedPhotoDetail>(SYNCED_EVENT, { detail }));
}

/** Wipe the device queue (sign-out on a shared phone). */
export async function clearQueue(store: QueueStore = idbQueueStore): Promise<void> {
  for (const i of await store.list()) await store.remove(i.clientUploadId);
}

/** Drop every item that does not belong to `userId` (a different user signed in on this device). */
export async function purgeOtherUsers(userId: string, store: QueueStore = idbQueueStore): Promise<number> {
  let n = 0;
  for (const i of await store.list()) {
    if (i.userId !== userId) {
      await store.remove(i.clientUploadId);
      n += 1;
    }
  }
  return n;
}

/** Marks the sign-out forms; PwaSessionGuard clears the queue when one is submitted. */
export const LOGOUT_FORM_ATTR = 'data-rm-logout';

/** Only touch IndexedDB if the receiver database already exists (never create it just to check). */
export async function queueDbExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases;
  if (!list) return true;
  return (await list.call(indexedDB)).some((d) => d.name === 'restomatch-receiver');
}

export async function enqueuePhoto(
  item: Omit<QueuedPhoto, 'createdAt' | 'attempts' | 'lastError'>,
  store: QueueStore = idbQueueStore,
): Promise<void> {
  await store.put({ ...item, createdAt: Date.now(), attempts: 0, lastError: null });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}
