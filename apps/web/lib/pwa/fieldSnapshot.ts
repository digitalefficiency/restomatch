/**
 * The offline read snapshot of the receiving field route (W2-05 slice A,
 * acceptance 9): the receiving board and today's PO pages, fetched by the
 * signed-in page while online and kept in ONE Cache Storage cache, so
 * `/dashboard/receiving/[poId]` still renders with zero bars. The receiver
 * service worker only READS it, and only when the network fails.
 *
 * It is this user's tenant data, so:
 * - the cache records whose snapshot it is; a different user (or branch)
 *   wipes it before writing their own;
 * - sign-out purges it (PwaSessionGuard), and so does any 401 while refreshing it;
 * - nothing but same-origin `/dashboard/receiving` GET pages ever goes in.
 */

export const SNAPSHOT_CACHE = 'rm-receiver-snapshot-v1';
/** Synthetic entry that names the snapshot's owner (`<userId>:<restaurantId>`). */
export const SNAPSHOT_OWNER_PATH = '/dashboard/receiving/__snapshot-owner';
/** At most this many pages (a board day is ~3–15 deliveries). */
export const SNAPSHOT_MAX_PAGES = 30;
const SCOPE = '/dashboard/receiving';

export function snapshotPathAllowed(path: string): boolean {
  return (
    path === SCOPE ||
    (/^\/dashboard\/receiving\/[0-9a-f-]{36}$/i.test(path) && !path.includes('..'))
  );
}

function cachesApi(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches;
}

export async function purgeFieldSnapshot(): Promise<void> {
  try {
    await cachesApi()?.delete(SNAPSHOT_CACHE);
  } catch {
    /* storage blocked */
  }
}

/**
 * Refresh the snapshot with these pages (best effort, sequential: a phone on
 * a weak link). Returns how many pages were stored.
 */
export async function refreshFieldSnapshot(owner: { userId: string; restaurantId: string }, paths: string[]): Promise<number> {
  const api = cachesApi();
  if (!api || typeof fetch === 'undefined') return 0;
  const ownerKey = `${owner.userId}:${owner.restaurantId}`;
  try {
    const cache = await api.open(SNAPSHOT_CACHE);
    const prev = await cache.match(SNAPSHOT_OWNER_PATH);
    if (prev && (await prev.text()) !== ownerKey) {
      await api.delete(SNAPSHOT_CACHE);
      return refreshFieldSnapshot(owner, paths);
    }
    await cache.put(SNAPSHOT_OWNER_PATH, new Response(ownerKey, { headers: { 'content-type': 'text/plain' } }));
    const wanted = [...new Set(paths)].filter(snapshotPathAllowed).slice(0, SNAPSHOT_MAX_PAGES);
    // Pages no longer on today's list leave the snapshot.
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (p !== SNAPSHOT_OWNER_PATH && !wanted.includes(p)) await cache.delete(req);
    }
    let stored = 0;
    for (const path of wanted) {
      const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'manual' }).catch(() => null);
      if (!res) break; // offline: keep what we have
      if (res.status === 401 || res.type === 'opaqueredirect' || res.redirected) {
        // Signed out under us (redirect to /login): nothing of this user stays.
        await purgeFieldSnapshot();
        return 0;
      }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) continue;
      await cache.put(path, res);
      stored += 1;
    }
    return stored;
  } catch {
    return 0;
  }
}
