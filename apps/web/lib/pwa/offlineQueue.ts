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
  restaurantId?: string,
): Promise<ProcessResult> {
  // Another restaurant's photos (shared device / restaurant switch) are never
  // uploaded into the current one; they wait until that restaurant is active.
  const items = (await store.list())
    .filter((i) => !restaurantId || i.restaurantId === restaurantId)
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
  return { uploaded, failed, remaining: left.filter((i) => !restaurantId || i.restaurantId === restaurantId).length };
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

/** Wipe the device queue (sign-out on a shared phone). */
export async function clearQueue(store: QueueStore = idbQueueStore): Promise<void> {
  for (const i of await store.list()) await store.remove(i.clientUploadId);
}

export async function enqueuePhoto(
  item: Omit<QueuedPhoto, 'createdAt' | 'attempts' | 'lastError'>,
  store: QueueStore = idbQueueStore,
): Promise<void> {
  await store.put({ ...item, createdAt: Date.now(), attempts: 0, lastError: null });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}
