/**
 * Service worker for the receiver PWA (flag `receiverPwa`), served from the
 * origin root. Two registrations: scope `/dashboard/receiving` (W2-05 offline
 * shell, lib/pwa/ReceiverPwa.tsx) and scope `/dashboard/` (W3-03b share target
 * and push, lib/pwa/registerWorker.ts); the narrower one controls receiving. Public (the last path segment
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
 *
 * W3-03b (app-wide PWA, scope /dashboard/):
 * - Share target: the manifest's POST multipart to SHARE_ACTION is caught here
 *   and parked in "rm-share-v1" (one entry per share: meta JSON + up to
 *   SHARE_MAX_FILES image/PDF files, each ≤ SHARE_MAX_BYTES), then 303 →
 *   /dashboard/share?id=… . The page reads it once and deletes it
 *   (lib/pwa/shareInbox.ts); entries older than a day are dropped here.
 *   Without this worker the POST reaches the server route, which keeps the text.
 * - Push: shows the notification; a click focuses/opens the exact card. Only a
 *   same-origin /dashboard path is ever opened (anything else → /dashboard).
 *   The payload never carries ₪ (the sender's contract).
 */
const SW_SOURCE = String.raw`
const CACHE = 'rm-receiver-v2';
const STATIC_CACHE = 'rm-receiver-static-v1';
const SNAPSHOT_CACHE = 'rm-receiver-snapshot-v1';
const SHARE_CACHE = 'rm-share-v1';
const KEEP = [CACHE, STATIC_CACHE, SNAPSHOT_CACHE, SHARE_CACHE];
const SHARE_ACTION = '/dashboard/share/receive';
const SHARE_OWNER_PATH = '/__share/owner';
// Two registrations run this script: scope /dashboard/receiving (W2-05, the
// offline shell) and scope /dashboard/ (W3-03b, share/push). Only the first
// answers page navigations. No registration info (an old test harness) = shell.
const RECEIVING_SHELL = !(self.registration && self.registration.scope)
  || new URL(self.registration.scope).pathname.replace(/\/$/, '').endsWith('/dashboard/receiving');
const SHARE_MAX_FILES = 10;
const SHARE_MAX_BYTES = 20 * 1024 * 1024;
const SHARE_TTL_MS = 24 * 3600 * 1000;
const SHARE_TYPES = /^(image\/|application\/pdf$)/;
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
  // Shared files are this user's too: they go with the snapshot.
  if (event.data && event.data.type === 'rm-purge-snapshot') {
    event.waitUntil(Promise.all([caches.delete(SNAPSHOT_CACHE), caches.delete(SHARE_CACHE)]));
  }
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

function shareId() {
  const a = new Uint8Array(12);
  self.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function dropOldShares(cache, now) {
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    if (!path.endsWith('/meta')) continue;
    const res = await cache.match(key);
    const meta = res ? await res.json().catch(() => null) : null;
    if (meta && now - meta.at < SHARE_TTL_MS) continue;
    const prefix = path.slice(0, -'meta'.length);
    for (const k of await cache.keys()) if (new URL(k.url).pathname.startsWith(prefix)) await cache.delete(k);
  }
}

// The share sheet's POST: park what was shared on this device, then hand the
// page a one-time id. Text is capped; files must be an image or a PDF.
async function parkShare(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return Response.redirect(new URL('/dashboard/share?error=unreadable', self.location.origin).href, 303);
  }
  const str = (k) => (typeof form.get(k) === 'string' ? String(form.get(k)).slice(0, 8000) : '');
  const files = [];
  let skipped = 0;
  for (const f of form.getAll('files')) {
    if (typeof f === 'string') continue;
    if (files.length >= SHARE_MAX_FILES || f.size > SHARE_MAX_BYTES || !SHARE_TYPES.test(f.type || '')) {
      skipped += 1;
      continue;
    }
    files.push(f);
  }
  const id = shareId();
  const cache = await caches.open(SHARE_CACHE);
  const now = Date.now();
  await dropOldShares(cache, now);
  // Whose share this is: the signed-in page keeps /__share/owner current
  // (claimSharesFor on mount; sign-out deletes the cache, so no stamp = signed out).
  const stamp = await cache.match(SHARE_OWNER_PATH);
  const owner = stamp ? (await stamp.text()).trim().slice(0, 200) : '';
  const meta = {
    at: now,
    owner,
    title: str('title'),
    text: str('text'),
    url: str('url'),
    skipped,
    files: files.map((f, i) => ({ key: '/__share/' + id + '/file-' + i, name: String(f.name || '').slice(0, 200), type: f.type, size: f.size })),
  };
  for (let i = 0; i < files.length; i += 1) {
    await cache.put(meta.files[i].key, new Response(files[i], { headers: { 'content-type': files[i].type } }));
  }
  await cache.put('/__share/' + id + '/meta', new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
  return Response.redirect(new URL('/dashboard/share?id=' + id, self.location.origin).href, 303);
}

// Only ever open a same-origin dashboard path from a notification.
function safeTarget(raw) {
  try {
    const u = new URL(String(raw || ''), self.location.origin);
    if (u.origin !== self.location.origin) return '/dashboard';
    if (u.pathname !== '/dashboard' && !u.pathname.startsWith('/dashboard/')) return '/dashboard';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/dashboard';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'RestoMatch';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    dir: 'auto',
    lang: typeof data.lang === 'string' ? data.lang : 'he',
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    data: { url: safeTarget(data.url) },
  };
  const work = [self.registration.showNotification(title, options)];
  const nav = self.navigator;
  if (typeof data.badge === 'number' && nav && typeof nav.setAppBadge === 'function') {
    work.push((data.badge > 0 ? nav.setAppBadge(data.badge) : nav.clearAppBadge()).catch(() => null));
  }
  event.waitUntil(Promise.all(work));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        return w.focus().then((f) => (f && typeof f.navigate === 'function' ? f.navigate(target) : f));
      }
      return self.clients.openWindow(target);
    }),
  );
});

async function offlineNavigation(url) {
  const snapshot = await caches.open(SNAPSHOT_CACHE);
  const page = await snapshot.match(url.pathname, { ignoreSearch: true });
  return page || caches.match('/pwa/offline.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname === SHARE_ACTION) {
    event.respondWith(parkShare(req));
    return;
  }
  if (req.method !== 'GET') return;
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
  // Only the receiving pages, and only in the receiving registration (W2-05's
  // offline shell, registered by ReceiverPwa for the roles that open receiving).
  // The app-wide registration (W3-03b) leaves every navigation to the browser,
  // so the real status (the in-shell 403, a 404) reaches the page as before.
  if (req.mode === 'navigate' && RECEIVING_SHELL && (url.pathname === '/dashboard/receiving' || url.pathname.startsWith('/dashboard/receiving/'))) {
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
