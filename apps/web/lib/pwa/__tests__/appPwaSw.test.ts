import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../../app/receiver-sw.js/route';
import { POST as receivePost, GET as receiveGet } from '../../../app/dashboard/share/receive/route';
import { claimSharesFor, readShare, routeShare, shareText, takeShareFiles, isShareId, type CacheLike, type CacheStorageLike } from '../shareInbox';
import { purgeFieldSnapshot } from '../fieldSnapshot';
import { MANIFEST_BASE } from '../manifest';
import { canFollowPath } from '../../nav/visibility';
import { loginEndsAtMs, SESSION_TTL_LONG_SEC } from '../../sessionLifetime';

const ORIGIN = 'https://app.test';
/** A live session's expiry (the owner stamp lapses with it). */
const LIVE = () => Date.now() + 3600_000;

/** Cache Storage keyed by pathname: enough for the worker and shareInbox. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: Request | string) => m.get(keyOf(r))?.clone(),
      put: async (r: Request | string, res: Response) => void m.set(keyOf(r), res),
      keys: async () => [...m.keys()].map((p) => new Request(ORIGIN + p)),
      delete: async (r: Request | string) => m.delete(keyOf(r)),
      addAll: async (paths: string[]) => paths.forEach((p) => m.set(p, new Response(p))),
    };
  };
  return {
    stores,
    open,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (n: string) => stores.delete(n),
      match: async (r: Request | string, o?: { cacheName?: string }) => {
        // Like CacheStorage.match: `cacheName` searches only that cache and never creates it.
        for (const [name, m] of stores) {
          if (o?.cacheName && name !== o.cacheName) continue;
          const hit = m.get(keyOf(r));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

async function loadWorker(scope = `${ORIGIN}/dashboard`, fetchImpl: (r: unknown) => Promise<Response> = vi.fn()) {
  const src = await GET().text();
  const listeners: Record<string, (e: unknown) => void> = {};
  const c = fakeCaches();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const badge = { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  type Win = { url: string; controlled?: boolean; focus: () => Promise<unknown>; navigate: (u: string) => Promise<unknown> };
  let windows: Win[] = [];
  // Chromium: a notificationclick grants ONE window interaction, spent by focus() or openWindow().
  let token = 0;
  const spend = () => {
    if (token < 1) throw new Error('Not allowed to open a window.');
    token -= 1;
  };
  const self = {
    location: { origin: ORIGIN },
    crypto: globalThis.crypto,
    navigator: { setAppBadge: badge.set, clearAppBadge: badge.clear },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: () => Promise.resolve(),
    registration: {
      scope,
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: async (o?: { includeUncontrolled?: boolean }) => windows.filter((w) => o?.includeUncontrolled || w.controlled !== false),
      openWindow: async (u: string) => {
        spend();
        opened.push(u);
      },
    },
  };
  runInNewContext(src, { self, caches: c.api, fetch: fetchImpl, URL, Request, Response, Promise, console, Uint8Array, Array, String, Date, JSON });
  const run = async (type: string, event: Record<string, unknown>) => {
    if (type === 'notificationclick') token = 1;
    let waited: Promise<unknown> = Promise.resolve();
    let responded: Promise<Response> | null = null;
    listeners[type]!({
      ...event,
      waitUntil: (p: Promise<unknown>) => void (waited = p),
      respondWith: (p: Promise<Response>) => void (responded = p),
    });
    await waited;
    return responded ? await (responded as Promise<Response>) : null;
  };
  /** A window whose focus() spends the click's one interaction, like Chromium. */
  const win = (url: string, navigate: (u: string) => Promise<unknown>, controlled = true): Win & { focused: number } => {
    const w: Win & { focused: number } = { url, controlled, navigate, focused: 0, focus: async () => (spend(), (w.focused += 1), w) };
    return w;
  };
  /** The click's grant runs out (Chromium: about 10 s), e.g. during a slow page load. */
  const expireGrant = () => void (token = 0);
  return { run, caches: c, shown, opened, badge, win, expireGrant, setWindows: (w: Win[]) => void (windows = w) };
}

function shareRequest(form: FormData) {
  return new Request(`${ORIGIN}/dashboard/share/receive`, { method: 'POST', body: form });
}

describe('share target in the worker (W3-03b)', () => {
  it('parks files + text on the device and hands the page a one-time id', async () => {
    const w = await loadWorker();
    const form = new FormData();
    form.set('title', 'חשבונית');
    form.set('text', 'ירקות השרון 12.11');
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'inv.pdf', { type: 'application/pdf' }));
    form.append('files', new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' }));
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    expect(res.status).toBe(303);
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    expect(isShareId(id)).toBe(true);

    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    const item = await readShare(id, open);
    expect(item?.title).toBe('חשבונית');
    expect(item?.skipped).toBe(1); // the text file is refused
    expect(item?.files.map((f) => [f.name, f.type])).toEqual([['inv.pdf', 'application/pdf']]);
    expect(routeShare(item)).toEqual({ kind: 'files', count: 1 });

    const files = await takeShareFiles(item!, open);
    expect(files).toHaveLength(1);
    expect(new Uint8Array(await files[0]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readShare(id, open)).toBeNull(); // taken once
  });

  it('a text-only share routes to the order capture', async () => {
    const w = await loadWorker();
    const form = new FormData();
    form.set('text', '5 ק״ג עגבניות');
    form.set('url', 'https://wa.me/x');
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    expect(routeShare(await readShare(id, open))).toEqual({ kind: 'orderText', text: '5 ק״ג עגבניות\nhttps://wa.me/x' });
  });

  it("the real sign-out step deletes parked shares; another user's sign-in wipes them, the owner's keeps them", async () => {
    const w = await loadWorker();
    const park = async () => {
      const form = new FormData();
      form.set('title', 'ספק');
      form.append('files', new File([new Uint8Array([9])], 'owner.pdf', { type: 'application/pdf' }));
      const res = (await w.run('fetch', { request: shareRequest(form) }))!;
      return new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    };
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;

    // The owner signs in on this phone: their share is stamped as theirs and survives a re-mount.
    let id = await park();
    expect(await claimSharesFor('owner-1', LIVE(), api)).toBe(false);
    expect(await claimSharesFor('owner-1', LIVE(), api)).toBe(false);
    expect((await readShare(id, open))?.files).toHaveLength(1);

    // A receiver signs in next (no sign-out in between): the owner's share is gone before anything reads it.
    expect(await claimSharesFor('receiver-2', LIVE(), api)).toBe(true);
    expect(await readShare(id, open)).toBeNull();

    // The guarded sign-out's purge (PwaSessionGuard → purgeFieldSnapshot) deletes rm-share-v1.
    id = await park();
    expect((await readShare(id, open))?.files).toHaveLength(1);
    vi.stubGlobal('caches', w.caches.api);
    try {
      await purgeFieldSnapshot();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(w.caches.stores.has('rm-share-v1')).toBe(false);
    expect(await readShare(id, open)).toBeNull();
  });

  it('each share carries the user it was parked under: claim on an empty device → park → another user claims → gone', async () => {
    const w = await loadWorker();
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    const park = async () => {
      const form = new FormData();
      form.append('files', new File([new Uint8Array([7])], 'a.pdf', { type: 'application/pdf' }));
      const res = (await w.run('fetch', { request: shareRequest(form) }))!;
      return new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    };
    expect(w.caches.stores.has('rm-share-v1')).toBe(false);
    expect(await claimSharesFor('user-a', LIVE(), api)).toBe(false); // empty device: the stamp is written anyway
    const id = await park();
    expect((await readShare(id, open))?.owner).toBe('user-a');
    expect(await claimSharesFor('user-b', LIVE(), api)).toBe(true);
    expect(await readShare(id, open)).toBeNull();
  });

  it('a share parked while signed out goes to the first user who signs in, and only to them', async () => {
    const w = await loadWorker();
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    // user A was here, then signed out (the purge deletes the cache, owner stamp included).
    await claimSharesFor('user-a', LIVE(), api);
    vi.stubGlobal('caches', w.caches.api);
    try {
      await purgeFieldSnapshot();
    } finally {
      vi.unstubAllGlobals();
    }
    const form = new FormData();
    form.set('text', 'הזמנה מהווטסאפ');
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    expect((await readShare(id, open))?.owner).toBe('');
    expect(await claimSharesFor('user-b', LIVE(), api)).toBe(false);
    expect((await readShare(id, open))?.owner).toBe('user-b');
    expect(await claimSharesFor('user-c', LIVE(), api)).toBe(true);
    expect(await readShare(id, open)).toBeNull();
  });

  it("an expired owner stamp is no owner: the next user's signed-out share is kept and becomes theirs", async () => {
    const w = await loadWorker();
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    await claimSharesFor('user-a', Date.now() - 1000, api); // A's session ran out, no sign-out
    const form = new FormData();
    form.set('text', 'ספק חדש');
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    expect((await readShare(id, open))?.owner).toBe('');
    expect(await claimSharesFor('user-b', LIVE(), api)).toBe(false);
    expect((await readShare(id, open))?.owner).toBe('user-b');
  });

  it("the stamp lapses with the real login (1 day without remember-me), not Auth.js's sliding 30-day expires", async () => {
    const w = await loadWorker();
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    const now = Date.now();
    const loginAt = now - 25 * 3600_000; // signed in 25 h ago, "remember me" off (the password form's default)
    const authJsExpires = now + SESSION_TTL_LONG_SEC * 1000; // what session.expires says: never in the past
    expect(authJsExpires).toBeGreaterThan(now);
    const loginEnds = loginEndsAtMs(loginAt, false)!;
    expect(loginEnds).toBeLessThan(now);
    expect(loginEndsAtMs(loginAt, true)).toBeGreaterThan(now);
    await claimSharesFor('user-a', loginEnds, api);
    const form = new FormData();
    form.set('text', 'אחרי שהכניסה פגה');
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    expect((await readShare(id, open))?.owner).toBe('');
  });

  it('a failed owner-stamp write never skips the purge', async () => {
    const w = await loadWorker();
    const api = w.caches.api as unknown as CacheStorageLike;
    const open = async () => (await w.caches.open('rm-share-v1')) as unknown as CacheLike;
    await claimSharesFor('user-a', LIVE(), api);
    const form = new FormData();
    form.set('text', 'של א');
    const res = (await w.run('fetch', { request: shareRequest(form) }))!;
    const id = new URL(res.headers.get('location')!, ORIGIN).searchParams.get('id');
    const cache = await api.open('rm-share-v1');
    const brokenPut: CacheStorageLike = {
      ...api,
      open: async () => ({ ...cache, keys: cache.keys, delete: cache.delete, match: cache.match, put: async () => Promise.reject(new Error('quota')) }),
    };
    expect(await claimSharesFor('user-b', LIVE(), brokenPut)).toBe(true);
    expect(await readShare(id, open)).toBeNull();
  });

  it('rejects garbage ids and dedupes repeated lines', async () => {
    expect(isShareId('../meta')).toBe(false);
    expect(await readShare('nope')).toBeNull();
    expect(shareText({ title: 'a', text: 'a', url: ' ' })).toBe('a');
    expect(routeShare(null)).toEqual({ kind: 'empty' });
  });
});

describe('share target without a worker (server fallback)', () => {
  it('keeps the text, drops files, never 404s', async () => {
    const form = new FormData();
    form.set('text', 'הזמנה');
    form.append('files', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    const req = new Request(`${ORIGIN}/dashboard/share/receive`, { method: 'POST', body: form });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await receivePost(req as never);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/dashboard/share');
    expect(loc.searchParams.get('text')).toBe('הזמנה');
    expect(loc.searchParams.get('files')).toBe('lost');

    const g = new Request(`${ORIGIN}/dashboard/share/receive?text=x`);
    Object.defineProperty(g, 'nextUrl', { value: new URL(g.url) });
    expect(new URL(receiveGet(g as never).headers.get('location')!).pathname).toBe('/dashboard/share');
  });
});

describe('two registrations, one script (W3-03b)', () => {
  const nav = (w: Awaited<ReturnType<typeof loadWorker>>, path: string) =>
    w.run('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'navigate' } });
  /** The receiving board's snapshot, owner-stamped as fieldSnapshot does, and (unless exp is null) that user's login stamp. */
  const liveBoard = async (w: Awaited<ReturnType<typeof loadWorker>>, userId: string, exp: number | null) => {
    const snap = await w.caches.open('rm-receiver-snapshot-v1');
    await snap.put('/dashboard/receiving', new Response('<html>board</html>'));
    await snap.put('/dashboard/receiving/__snapshot-owner', new Response(`${userId}:rest-1`));
    if (exp !== null) await (await w.caches.open('rm-share-v1')).put('/__share/owner', new Response(JSON.stringify({ userId, exp })));
  };
  it('the app-wide registration leaves every other navigation to the browser; the receiving one keeps the offline shell', async () => {
    const app = await loadWorker();
    expect(await nav(app, '/dashboard/chain')).toBeNull();
    expect(await nav(app, '/dashboard/receiving')).toBeNull(); // a bookkeeper's 403 stays a 403
    const shell = await loadWorker(`${ORIGIN}/dashboard/receiving`);
    expect(await nav(shell, '/dashboard/receivingx')).toBeNull();
    expect(await nav(shell, '/dashboard')).toBeNull();
  });
  it('the launch page /dashboard: online, the network answer as is; offline, the offline page (not a network error)', async () => {
    const online = await loadWorker(`${ORIGIN}/dashboard`, async () => new Response('forbidden', { status: 403 }));
    expect((await nav(online, '/dashboard'))!.status).toBe(403);
    const offline = await loadWorker(`${ORIGIN}/dashboard`, async () => Promise.reject(new TypeError('Failed to fetch')));
    await offline.run('install', {});
    const html = readFileSync(join(__dirname, '../../../public/pwa/offline.html'), 'utf8');
    await (await offline.caches.open('rm-receiver-v2')).put('/pwa/offline.html', new Response(html));
    const page = (await nav(offline, '/dashboard'))!;
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('אין חיבור לאינטרנט');
    // Every role launches the app; not every role can open receiving: the launch's offline page retries the launch.
    expect(body).toContain('href="/dashboard?source=pwa"'); // no receiving snapshot on this phone
    // The receiving shell's own fallback keeps the way into the board (its live owner's snapshot).
    const shell = await loadWorker(`${ORIGIN}/dashboard/receiving`, async () => Promise.reject(new TypeError('offline')));
    await (await shell.caches.open('rm-receiver-v2')).put('/pwa/offline.html', new Response(html));
    await liveBoard(shell, 'user-a', Date.now() + 3600_000);
    expect(await (await nav(shell, '/dashboard/receiving/x'))!.text()).toContain('href="/dashboard/receiving?source=pwa"');
    // Never an empty snapshot cache created on a phone that had none.
    expect(offline.caches.stores.has('rm-receiver-snapshot-v1')).toBe(false);
  });
  it("a receiver's cold offline start: with a live receiver's board snapshot on the phone, the launch page links into it", async () => {
    const html = readFileSync(join(__dirname, '../../../public/pwa/offline.html'), 'utf8');
    const w = await loadWorker(`${ORIGIN}/dashboard`, async () => Promise.reject(new TypeError('offline')));
    await (await w.caches.open('rm-receiver-v2')).put('/pwa/offline.html', new Response(html));
    await liveBoard(w, 'user-a', Date.now() + 3600_000);
    const body = await (await nav(w, '/dashboard'))!.text();
    expect(body).toContain('href="/dashboard/receiving?source=pwa"');
    expect(body).not.toContain('href="/dashboard?source=pwa"');
  });
  it("the previous user's board is never linked from the launch: lapsed login, no login stamp, or someone else's", async () => {
    const html = readFileSync(join(__dirname, '../../../public/pwa/offline.html'), 'utf8');
    for (const login of [{ userId: 'user-a', exp: Date.now() - 1 }, null, { userId: 'user-b', exp: Date.now() + 3600_000 }]) {
      const w = await loadWorker(`${ORIGIN}/dashboard`, async () => Promise.reject(new TypeError('offline')));
      await (await w.caches.open('rm-receiver-v2')).put('/pwa/offline.html', new Response(html));
      await liveBoard(w, 'user-a', null);
      if (login) await (await w.caches.open('rm-share-v1')).put('/__share/owner', new Response(JSON.stringify(login)));
      const body = await (await nav(w, '/dashboard'))!.text();
      expect(body).toContain('href="/dashboard?source=pwa"');
      expect(body).not.toContain('/dashboard/receiving');
    }
  });
  it('the manifest is network first (a deploy reaches the installed app), the precached copy offline', async () => {
    const get = (w: Awaited<ReturnType<typeof loadWorker>>) =>
      w.run('fetch', { request: { url: `${ORIGIN}/pwa/manifest.webmanifest`, method: 'GET', mode: 'no-cors' } });
    const online = await loadWorker(`${ORIGIN}/dashboard`, async () => new Response('{"v":"new"}'));
    await (await online.caches.open('rm-receiver-v2')).put('/pwa/manifest.webmanifest', new Response('{"v":"old"}'));
    expect(await (await get(online))!.text()).toBe('{"v":"new"}');
    const offline = await loadWorker(`${ORIGIN}/dashboard`, async () => Promise.reject(new TypeError('offline')));
    await (await offline.caches.open('rm-receiver-v2')).put('/pwa/manifest.webmanifest', new Response('{"v":"old"}'));
    expect(await (await get(offline))!.text()).toBe('{"v":"old"}');
  });
  it('PRECACHE_REV is the hash of the precached files: change one and the worker must change too', async () => {
    const src = await GET().text();
    const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)![1]!.match(/'([^']+)'/g)!.map((q) => q.slice(1, -1));
    const h = createHash('sha256');
    for (const p of list) h.update(readFileSync(join(__dirname, '../../../public', p)));
    expect(/const PRECACHE_REV = '([0-9a-f]{12})';/.exec(src)?.[1]).toBe(h.digest('hex').slice(0, 12));
  });
});

describe('push + notification click (W3-03b)', () => {
  it('shows the notification and sets the app badge', async () => {
    const w = await loadWorker();
    await w.run('push', { data: { json: () => ({ title: '3 משלוחים היום', body: 'ירקות השרון 09:00', url: '/dashboard/receiving/abc', badge: 2 }) } });
    expect(w.shown[0]?.title).toBe('3 משלוחים היום');
    expect((w.shown[0]?.options.data as { url: string }).url).toBe('/dashboard/receiving/abc');
    expect(w.badge.set).toHaveBeenCalledWith(2);
  });

  it('never opens a foreign or non-dashboard URL', async () => {
    const w = await loadWorker();
    for (const url of ['https://evil.test/dashboard', '/login', 'javascript:alert(1)', '//evil.test/x']) {
      await w.run('push', { data: { json: () => ({ title: 't', url }) } });
    }
    expect(w.shown.map((s) => (s.options.data as { url: string }).url)).toEqual(['/dashboard', '/dashboard', '/dashboard', '/dashboard']);
  });

  it('a click focuses an open window first (while the grant is fresh), then navigates it to the card; none → opens one', async () => {
    const w = await loadWorker();
    const close = vi.fn();
    await w.run('notificationclick', { notification: { close, data: { url: '/dashboard/approvals?invoice=1' } } });
    expect(close).toHaveBeenCalled();
    expect(w.opened).toEqual(['/dashboard/approvals?invoice=1']);

    // A slow page load: the grant runs out before navigate() resolves. Focus already happened.
    const navigate = vi.fn(async () => {
      w.expireGrant();
      return open;
    });
    const open = w.win(`${ORIGIN}/dashboard/orders`, navigate);
    w.setWindows([open]);
    await w.run('notificationclick', { notification: { close, data: { url: '/dashboard/receiving/9' } } });
    expect(open.focused).toBe(1);
    expect(navigate).toHaveBeenCalledWith('/dashboard/receiving/9');
    expect(w.opened).toHaveLength(1); // navigated in place, no second window
  });

  it('navigate() resolves null or rejects (offline error page, cross-origin redirect): no second window after the focus', async () => {
    for (const navigate of [vi.fn(async () => null), vi.fn(async () => Promise.reject(new TypeError('navigation failed')))]) {
      const w = await loadWorker();
      const open = w.win(`${ORIGIN}/dashboard/orders`, navigate);
      w.setWindows([open]);
      await w.run('notificationclick', { notification: { close: vi.fn(), data: { url: '/dashboard/approvals?invoice=7' } } });
      expect(open.focused).toBe(1);
      expect(navigate).toHaveBeenCalledWith('/dashboard/approvals?invoice=7');
      expect(w.opened).toEqual([]);
    }
  });

  it("a window another registration controls (the receiving board, /login) is never navigated: a new window opens", async () => {
    const w = await loadWorker();
    const navigate = vi.fn(async () => null);
    w.setWindows([w.win(`${ORIGIN}/dashboard/receiving`, navigate, false), w.win(`${ORIGIN}/login`, navigate, false)]);
    await w.run('notificationclick', { notification: { close: vi.fn(), data: { url: '/dashboard/receiving/5' } } });
    expect(navigate).not.toHaveBeenCalled();
    expect(w.opened).toEqual(['/dashboard/receiving/5']);
  });
});

describe('app-wide manifest (W3-03b)', () => {
  const m = JSON.parse(readFileSync(join(__dirname, '../../../public/pwa/manifest.webmanifest'), 'utf8'));
  it('the static file is the base: id kept, whole dashboard in scope, start_url inside it, no shortcuts', () => {
    expect(m).toEqual(JSON.parse(JSON.stringify(MANIFEST_BASE)));
    expect(m.id).toBe('/dashboard/receiving');
    // No trailing slash: Next 308s /dashboard/ → /dashboard, so the scope must cover /dashboard itself.
    expect(m.scope).toBe('/dashboard');
    expect(m.start_url).toBe('/dashboard?source=pwa');
    expect(new URL(m.start_url, ORIGIN).pathname.startsWith(m.scope)).toBe(true);
    expect(m.start_url).not.toMatch(/\/\?|\/$/);
    // Installed shortcuts belong to the device, not the user (shared back-door phone).
    expect(m.shortcuts).toBeUndefined();
  });
  it('shares by POST multipart (images, PDF, text) to the receive route', () => {
    expect(m.share_target).toMatchObject({ action: '/dashboard/share/receive', method: 'POST', enctype: 'multipart/form-data' });
    expect(m.share_target.params.files[0].accept).toEqual(['image/*', 'application/pdf']);
  });
  it('both shells link the one static manifest, without credentials', () => {
    for (const f of ['AppPwa.tsx', 'ReceiverPwa.tsx']) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(src).toContain('<link rel="manifest" href="/pwa/manifest.webmanifest" />');
      expect(src).not.toContain('use-credentials');
    }
  });
});

describe('a child route inherits its parent flags (canFollowPath)', () => {
  it('with inventoryCount off, no role is offered /dashboard/inventory/count', () => {
    for (const role of ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'] as const) {
      expect(canFollowPath({ role, features: [] }, '/dashboard/inventory/count')).toBe(false);
    }
    expect(canFollowPath({ role: 'owner', features: ['inventoryCount'] }, '/dashboard/inventory/count')).toBe(true);
  });
  it('a logical parent at another path does not gate a page (only URL ancestors do)', () => {
    expect(canFollowPath({ role: 'owner', features: [] }, '/dashboard/invoices/abc')).toBe(true);
  });
});

describe('worker registrations (W3-03b)', () => {
  it('app-wide at /dashboard (the launch page is controlled), the offline shell at /dashboard/receiving; never throws', async () => {
    const { registerAppWorker, registerReceivingWorker } = await import('../registerWorker');
    const register = vi.fn(async () => ({}));
    expect(await registerAppWorker({ register })).toBe(true);
    expect(await registerReceivingWorker({ register })).toBe(true);
    expect(register.mock.calls).toEqual([
      ['/receiver-sw.js', { scope: '/dashboard' }],
      ['/receiver-sw.js', { scope: '/dashboard/receiving' }],
    ]);
    expect(await registerAppWorker(undefined)).toBe(false);
    expect(await registerAppWorker({ register: async () => Promise.reject(new Error('x')) })).toBe(false);
  });
});
