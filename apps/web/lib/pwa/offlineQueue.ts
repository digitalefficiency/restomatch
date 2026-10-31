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
 * soon as the invoice is registered. Nothing is wiped by leaving: a photo the
 * receiver could not send uploads with the next signed-in user of the same
 * branch, attributed to whoever took it ("צולם על ידי", decision 22 default).
 */
export interface QueuedPhoto {
  clientUploadId: string;
  /** The restaurant the photo was taken for — only uploaded while that restaurant is active. */
  restaurantId: string;
  /** The signed-in user who took it (shared tablet: a colleague may upload it, attributed). */
  userId: string;
  /** Their display name at capture time, for "צולם על ידי". */
  capturedByName?: string | null;
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
  /** Uploaded photos a colleague took on this device ("צולם על ידי"). */
  attributed: Array<{ clientUploadId: string; capturedByName: string | null }>;
  /** The run stopped because the session is gone (401 / signed out): sign in to upload. */
  authExpired: boolean;
}

/**
 * Why a sync call failed — read from the HTTP status / tRPC error code, never
 * from the message text. `network` (no response) and `auth` (signed out, or
 * the branch changed under us) cost the item no attempt: nothing is wrong with
 * the photo. `permanent` (a 4xx) will not succeed by retrying.
 */
export type FailureKind = 'network' | 'auth' | 'retryable' | 'permanent';

/** Thrown when there is no session at all (expired / signed out): the receiver must sign in again. */
export class SessionGoneError extends Error {
  constructor(message = 'signed out — photo kept until the next sign-in') {
    super(message);
    this.name = 'SessionGoneError';
  }
}

/** Thrown when the session's branch / user no longer fits the queued item (another tab switched). */
export class ScopeChangedError extends Error {
  constructor(message = 'active restaurant changed — photo kept for its own branch') {
    super(message);
    this.name = 'ScopeChangedError';
  }
}

type ErrorShape = { httpStatus?: unknown; code?: unknown } | null | undefined;
interface ErrorLike {
  name?: unknown;
  status?: unknown;
  data?: ErrorShape;
  shape?: { data?: ErrorShape } | null;
  meta?: { response?: { status?: unknown } | null } | null;
  cause?: unknown;
}

const RETRYABLE_CODES = new Set(['TIMEOUT', 'TOO_MANY_REQUESTS', 'INTERNAL_SERVER_ERROR', 'CLIENT_CLOSED_REQUEST']);

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The HTTP status of a failed call, if the server answered at all. */
export function httpStatusOf(err: unknown): number | null {
  const e = (err ?? {}) as ErrorLike;
  return asNumber(e.data?.httpStatus) ?? asNumber(e.shape?.data?.httpStatus) ?? asNumber(e.meta?.response?.status) ?? asNumber(e.status);
}

/** The tRPC error code (UNAUTHORIZED, BAD_REQUEST…), if any. */
export function trpcCodeOf(err: unknown): string | null {
  const e = (err ?? {}) as ErrorLike;
  const code = e.data?.code ?? e.shape?.data?.code;
  return typeof code === 'string' ? code : null;
}

/** fetch() rejected before any response: offline, DNS, reset, aborted (by type, not wording). */
function noResponse(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as ErrorLike).cause, depth += 1) {
    if (e instanceof TypeError) return true;
    const name = (e as ErrorLike).name;
    if (name === 'TypeError' || name === 'AbortError' || name === 'NetworkError') return true;
  }
  return false;
}

export function classifyFailure(
  err: unknown,
  online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
): FailureKind {
  if (!online) return 'network';
  if (err instanceof ScopeChangedError || err instanceof SessionGoneError) return 'auth';
  const status = httpStatusOf(err);
  const code = trpcCodeOf(err);
  if (status === 401 || code === 'UNAUTHORIZED') return 'auth';
  if (status !== null || code !== null) {
    if (status !== null && (status >= 500 || status === 408 || status === 425 || status === 429)) return 'retryable';
    if (code !== null && RETRYABLE_CODES.has(code)) return 'retryable';
    return 'permanent';
  }
  return noResponse(err) ? 'network' : 'retryable';
}

/** After this many failed attempts an item stays queued but is no longer auto-retried in a loop. */
export const MAX_AUTO_ATTEMPTS = 8;

/**
 * Upload every queued photo of the active branch, oldest first — a
 * colleague's too (shared device), attributed to whoever took it. One at a
 * time (a phone on a weak connection), stopping at the first network or auth
 * failure — the rest wait for the next `online` event / sign-in, and those
 * failures cost no attempt. Items are removed ONLY after the invoice is
 * registered; a photo the server refuses for good (4xx) is parked, not lost.
 */
export async function processQueue(
  store: QueueStore,
  upload: PhotoUploader,
  isOnline: () => boolean = () => true,
  scope?: { restaurantId: string; userId: string },
): Promise<ProcessResult> {
  // Another branch's photos (restaurant switch) are never uploaded into the
  // active one; they wait for that branch.
  const inScope = (i: QueuedPhoto) => !scope || i.restaurantId === scope.restaurantId;
  const items = (await store.list())
    .filter(inScope)
    .sort((a, b) => a.createdAt - b.createdAt);
  const uploaded: string[] = [];
  const failed: string[] = [];
  const attributed: ProcessResult['attributed'] = [];
  let authExpired = false;
  for (const item of items) {
    if (!isOnline()) break;
    if (item.attempts >= MAX_AUTO_ATTEMPTS) continue;
    try {
      await upload(item);
      await store.remove(item.clientUploadId);
      uploaded.push(item.clientUploadId);
      if (scope && item.userId !== scope.userId) {
        attributed.push({ clientUploadId: item.clientUploadId, capturedByName: item.capturedByName ?? null });
      }
    } catch (err) {
      failed.push(item.clientUploadId);
      const kind = classifyFailure(err);
      const lastError = err instanceof Error ? err.message.slice(0, 300) : 'error';
      const attempts =
        kind === 'network' || kind === 'auth' ? item.attempts : kind === 'permanent' ? MAX_AUTO_ATTEMPTS : item.attempts + 1;
      await store.put({ ...item, attempts, lastError });
      // A branch switch is not an expired session: only a missing session asks for a sign-in.
      if (kind === 'auth' && !(err instanceof ScopeChangedError)) authExpired = true;
      if (kind === 'network' || kind === 'auth') break;
    }
  }
  const left = await store.list();
  return { uploaded, failed, remaining: left.filter(inScope).length, attributed, authExpired };
}

/** No response at all (offline / fetch rejected) — by error type and status, never by message text. */
export function isNetworkError(err: unknown): boolean {
  return classifyFailure(err) === 'network';
}

/** Kept on the phone and retried later, at no cost: no network, or signed out / branch changed. */
export function isTransientFailure(err: unknown): boolean {
  const kind = classifyFailure(err);
  return kind === 'network' || kind === 'auth';
}

let persistRequested = false;

/**
 * Ask the browser not to evict this origin's storage (the queued photos, the
 * unsent counts) under storage pressure. Once per page load, on the first
 * enqueue; best-effort (the browser may say no).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return false;
  persistRequested = true;
  try {
    const storage = (typeof navigator === 'undefined' ? undefined : navigator.storage) as
      | { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
      | undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.().catch(() => false)) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Tests only: forget that persistence was already requested. */
export function resetPersistRequest(): void {
  persistRequested = false;
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

/**
 * Wipe the whole device queue.
 * @deprecated Unsent photos are never wiped by leaving (keep and attribute,
 * decision 22). Kept for callers merging in the same release (W1-09); use
 * `clearForUser` for the explicit "delete my photos" choice.
 */
export async function clearQueue(store: QueueStore = idbQueueStore): Promise<void> {
  for (const i of await store.list()) await store.remove(i.clientUploadId);
}

/**
 * Drop every item that does not belong to `userId`. No longer called at sign-in:
 * other users' photos are kept and attributed (they upload when their owner
 * signs in again, never under another account — see processQueue's scope).
 */
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

/** Every queued photo on this device (every user, every branch). */
export async function pendingCountOnDevice(store: QueueStore = idbQueueStore): Promise<number> {
  return (await store.list()).length;
}

/** This user's queued photos (any branch) — the sign-out guard names this count. */
export async function countForUser(userId: string, store: QueueStore = idbQueueStore): Promise<number> {
  return (await store.list()).filter((i) => i.userId === userId).length;
}

/** Other users' photos waiting on this device (kept; this branch's upload, attributed, with the next sync). */
export async function countForOthers(userId: string, store: QueueStore = idbQueueStore): Promise<number> {
  return (await store.list()).filter((i) => i.userId !== userId).length;
}

/** Delete ONLY this user's queued photos — the explicit "delete and sign out" choice. */
export async function clearForUser(userId: string, store: QueueStore = idbQueueStore): Promise<void> {
  for (const i of await store.list()) if (i.userId === userId) await store.remove(i.clientUploadId);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}

/** Marks the sign-out forms; PwaSessionGuard runs the queued-photos guard when one is submitted. */
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
  void requestPersistentStorage();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_EVENT));
}
