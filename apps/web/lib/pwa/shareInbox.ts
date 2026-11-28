/**
 * W3-03b · the share-target inbox on this device. The service worker parks a
 * share (POST from the OS share sheet) in Cache Storage "rm-share-v1" and sends
 * the page /dashboard/share?id=… ; this module reads it back. Nothing here goes
 * to the network. A text-only share is read once and deleted; a share with
 * files stays (the worker drops it after a day) until a capture screen takes
 * the files with `takeShareFiles`.
 *
 * Shares are this user's content on a possibly shared phone, so:
 * - sign-out deletes the whole cache (`purgeFieldSnapshot` → `purgeShares`);
 * - the cache is stamped with its owner on every signed-in mount
 *   (`claimSharesFor`); a different user signing in wipes it first. A share
 *   parked before anyone signed in (the share sheet opened while signed out)
 *   goes to the first user who signs in.
 */

export const SHARE_CACHE = 'rm-share-v1';
/** Synthetic entry naming whose shares these are (a user id). Not a share itself. */
export const SHARE_OWNER_PATH = '/__share/owner';
const ID = /^[0-9a-f]{24}$/;

export interface SharedFileMeta {
  key: string;
  name: string;
  type: string;
  size: number;
}
export interface SharedItem {
  id: string;
  at: number;
  title: string;
  text: string;
  url: string;
  /** Files the worker refused (too many, too big, not an image or PDF). */
  skipped: number;
  files: SharedFileMeta[];
}

/** The part of CacheStorage this module needs (injectable for tests). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  delete(key: string): Promise<boolean>;
}
export type OpenCache = () => Promise<CacheLike | null>;

export const browserShareCache: OpenCache = async () =>
  typeof caches === 'undefined' ? null : ((await caches.open(SHARE_CACHE)) as unknown as CacheLike);

export function isShareId(raw: unknown): raw is string {
  return typeof raw === 'string' && ID.test(raw);
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** The parked share, or null (unknown id, expired, no Cache Storage, garbage). */
export async function readShare(id: unknown, open: OpenCache = browserShareCache): Promise<SharedItem | null> {
  if (!isShareId(id)) return null;
  const cache = await open().catch(() => null);
  if (!cache) return null;
  const res = await cache.match(`/__share/${id}/meta`).catch(() => undefined);
  if (!res) return null;
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const prefix = `/__share/${id}/file-`;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({ key: str(f.key, 200), name: str(f.name, 200), type: str(f.type, 100), size: Number(f.size) || 0 }))
    .filter((f) => f.key.startsWith(prefix));
  return {
    id,
    at: Number(raw.at) || 0,
    title: str(raw.title, 8000),
    text: str(raw.text, 8000),
    url: str(raw.url, 2000),
    skipped: Math.max(0, Number(raw.skipped) || 0),
    files,
  };
}

/** Delete the whole share (meta + files). */
export async function dropShare(item: Pick<SharedItem, 'id' | 'files'>, open: OpenCache = browserShareCache): Promise<void> {
  const cache = await open().catch(() => null);
  if (!cache) return;
  for (const f of item.files) await cache.delete(f.key).catch(() => false);
  await cache.delete(`/__share/${item.id}/meta`).catch(() => false);
}

/** The shared files as File objects, then the share is gone (a capture screen took them). */
export async function takeShareFiles(item: SharedItem, open: OpenCache = browserShareCache): Promise<File[]> {
  const cache = await open().catch(() => null);
  if (!cache) return [];
  const out: File[] = [];
  for (const f of item.files) {
    const res = await cache.match(f.key).catch(() => undefined);
    if (!res) continue;
    out.push(new File([await res.blob()], f.name || 'shared', { type: f.type }));
  }
  await dropShare(item, open);
  return out;
}

/** The text an order capture should start from: title, text and link, one per line, capped. */
export function shareText(item: Pick<SharedItem, 'title' | 'text' | 'url'>): string {
  return [item.title, item.text, item.url]
    .map((s) => s.trim())
    .filter((s, i, all) => s !== '' && all.indexOf(s) === i)
    .join('\n')
    .slice(0, 8000);
}

export type ShareRoute =
  | { kind: 'orderText'; text: string }
  | { kind: 'files'; count: number }
  | { kind: 'empty' };

/** Where a share goes: files → invoice capture (kept on the phone); text only → order capture. */
export function routeShare(item: SharedItem | null): ShareRoute {
  if (!item) return { kind: 'empty' };
  if (item.files.length > 0) return { kind: 'files', count: item.files.length };
  const text = shareText(item);
  return text ? { kind: 'orderText', text } : { kind: 'empty' };
}

/** The part of CacheStorage the owner checks need (injectable for tests). */
export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  open(name: string): Promise<{ match(key: string): Promise<Response | undefined>; put(key: string, res: Response): Promise<void> }>;
}
const storage = (): CacheStorageLike | null => (typeof caches === 'undefined' ? null : (caches as unknown as CacheStorageLike));

/** Delete every parked share on this device. Never throws. */
export async function purgeShares(api: CacheStorageLike | null = storage()): Promise<void> {
  try {
    await api?.delete(SHARE_CACHE);
  } catch {
    /* storage blocked */
  }
}

/**
 * Make the parked shares this user's: another user's shares are deleted, then
 * the cache is stamped with `userId`. Run on every signed-in shell mount and
 * before the share page reads. Returns whether it purged. Never throws.
 */
export async function claimSharesFor(userId: string, api: CacheStorageLike | null = storage()): Promise<boolean> {
  if (!api || !userId) return false;
  try {
    if (!(await api.keys()).includes(SHARE_CACHE)) return false;
    const stamp = await (await api.open(SHARE_CACHE)).match(SHARE_OWNER_PATH);
    const owner = stamp ? (await stamp.text()).trim() : null;
    let purged = false;
    if (owner && owner !== userId) {
      await api.delete(SHARE_CACHE);
      purged = true;
    }
    await (await api.open(SHARE_CACHE)).put(SHARE_OWNER_PATH, new Response(userId, { headers: { 'content-type': 'text/plain' } }));
    return purged;
  } catch {
    return false;
  }
}
