/**
 * Service worker for the receiver PWA (flag `receiverPwa`), served from the
 * origin root so it may control the scope `/dashboard/receiving` (registered
 * with that scope by lib/pwa/ReceiverPwa.tsx). Public (the last path segment
 * looks like a static asset) — it contains no tenant data.
 *
 * W2-05 offline shell. Three caches, each with ONE writer:
 * - "rm-receiver-v2" — exactly these public files, written at install:
 *   /pwa/offline.html, /pwa/manifest.webmanifest, /pwa/icon-192.png,
 *   /pwa/icon-512.png, /pwa/icon-maskable-512.png (cache-first).
 * - "rm-receiver-static-v1" — Next's build assets under /_next/static/
 *   (content-hashed, public, immutable): cache-first, written by this worker
 *   on the first successful same-origin GET whose response is marked
 *   `immutable` (never a dev server's chunks), capped at STATIC_MAX entries.
 * - "rm-receiver-snapshot-v1" — today's receiving pages for the signed-in
 *   user. Written ONLY by the page (lib/pwa/fieldSnapshot.ts: an allow-list of
 *   /dashboard/receiving and /dashboard/receiving/<uuid>, owner-stamped,
 *   purged on sign-out); this worker only READS it, and only when a
 *   navigation's network request fails.
 * NEVER CACHED HERE: any page HTML from the network, any /api/* or tRPC
 * response, any /scans/* file, any POST. Navigations go to the network first;
 * offline, the snapshot of that exact page, else the static offline page.
 * Field work done offline lives in IndexedDB (lib/pwa/outbox.ts), not here.
 */
const SW_SOURCE = String.raw`
const CACHE = 'rm-receiver-v2';
const STATIC_CACHE = 'rm-receiver-static-v1';
const SNAPSHOT_CACHE = 'rm-receiver-snapshot-v1';
const KEEP = [CACHE, STATIC_CACHE, SNAPSHOT_CACHE];
const STATIC_PREFIX = '/_next/static/';
const STATIC_MAX = 400;
const PRECACHE = [
  '/pwa/offline.html',
  '/pwa/manifest.webmanifest',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rm-receiver-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for the snapshot to go (sign-out); it also deletes it itself.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'rm-purge-snapshot') event.waitUntil(caches.delete(SNAPSHOT_CACHE));
});

async function staticAsset(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Only what Next marks immutable (a production build): a dev server's chunks are never kept.
  if (res.ok && res.type === 'basic' && /immutable/.test(res.headers.get('cache-control') || '')) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - STATIC_MAX))) await cache.delete(old);
  }
  return res;
}

async function offlineNavigation(url) {
  const snapshot = await caches.open(SNAPSHOT_CACHE);
  const page = await snapshot.match(url.pathname, { ignoreSearch: true });
  return page || caches.match('/pwa/offline.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Static PWA assets: cache-first (public files only).
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((hit) => hit || fetch(req)));
    return;
  }
  // Next build assets: content-hashed and public, so cache-first is safe.
  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(staticAsset(req));
    return;
  }
  // Page navigations: always the network (this worker never stores page HTML);
  // offline, the page's own snapshot of that page, else the static offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => offlineNavigation(url)));
  }
  // Everything else (API, tRPC, scans, RSC payloads) is not intercepted.
});
`;

export const dynamic = 'force-static';

export function GET() {
  return new Response(SW_SOURCE, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  });
}
