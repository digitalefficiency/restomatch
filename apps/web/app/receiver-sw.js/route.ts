/**
 * Service worker for the receiver PWA (flag `receiverPwa`), served from the
 * origin root so it may control the scope `/dashboard/receiving` (registered
 * with that scope by lib/pwa/ReceiverPwa.tsx). Public (the last path segment
 * looks like a static asset) — it contains no tenant data.
 *
 * WHAT IS CACHED (cache "rm-receiver-v1") — exactly these public, static files:
 *   /pwa/offline.html, /pwa/manifest.webmanifest, /pwa/icon-192.png,
 *   /pwa/icon-512.png, /pwa/icon-maskable-512.png
 * WHAT IS NEVER CACHED: any page HTML (authenticated), any /api/* or tRPC
 * response, any /scans/* file, any POST. Navigations inside the scope go to the
 * network; only when the network FAILS does the worker answer with the static
 * offline page. Photos taken offline live in IndexedDB (lib/pwa/offlineQueue.ts),
 * not in this cache.
 */
const SW_SOURCE = String.raw`
const CACHE = 'rm-receiver-v1';
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rm-receiver-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

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
  // Page navigations: always the network (authenticated HTML is never stored);
  // the static offline page only when the network is unreachable.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/pwa/offline.html')));
  }
  // Everything else (API, tRPC, scans, Next assets) is not intercepted.
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
