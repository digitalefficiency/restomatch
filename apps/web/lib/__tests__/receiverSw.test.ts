import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/receiver-sw.js/route';
import { SNAPSHOT_CACHE, snapshotPathAllowed } from '../pwa/fieldSnapshot';

const ORIGIN = 'https://app.test';

/** A tiny Cache Storage keyed by pathname (enough for the worker's own calls). */
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
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (n: string) => stores.delete(n),
      match: async (r: Request | string) => {
        for (const m of stores.values()) {
          const hit = m.get(keyOf(r));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
  };
}

/** Load the worker source into a sandbox and return a `fetch` dispatcher. */
async function loadWorker(network: (req: Request) => Promise<Response>) {
  const src = await GET().text();
  const listeners: Record<string, (e: unknown) => void> = {};
  const c = fakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  // A same-origin network response is `basic` in a browser (node's constructed ones are `default`).
  const fetchSpy = vi.fn(async (req: Request) => {
    const res = await network(req);
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  });
  runInNewContext(src, { self, caches: c.api, fetch: fetchSpy, URL, Request, Response, Promise, console });
  let installed: Promise<unknown> = Promise.resolve();
  listeners.install!({ waitUntil: (p: Promise<unknown>) => void (installed = p) });
  await installed;
  async function dispatch(url: string, init: { method?: string; mode?: string } = {}) {
    const request = { url: ORIGIN + url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } as unknown as Request;
    let responded: Promise<Response> | null = null;
    listeners.fetch!({ request, respondWith: (p: Promise<Response>) => void (responded = p) });
    return responded ? await (responded as Promise<Response>) : null;
  }
  return { dispatch, caches: c, fetchSpy, listeners };
}

const immutable = (body: string) =>
  new Response(body, { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' } });

/**
 * The receiver service worker caches ONLY public static PWA files and never
 * stores authenticated HTML or API responses (documented in the route).
 */
describe('receiver service worker', () => {
  it('is served as uncached JavaScript', async () => {
    const res = GET();
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('precaches exactly the public PWA files; its only cache.put is for /_next/static assets', async () => {
    const src = await GET().text();
    const list = /const PRECACHE = \[([\s\S]*?)\];/.exec(src)![1]!;
    const paths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(paths).toEqual([
      '/pwa/offline.html',
      '/pwa/manifest.webmanifest',
      '/pwa/icon-192.png',
      '/pwa/icon-512.png',
      '/pwa/icon-maskable-512.png',
    ]);
    // W2-05: exactly one write, inside the /_next/static handler; the snapshot is never written here.
    expect(src.match(/\.put\(/g)?.length).toBe(1);
    const staticFn = /async function staticAsset\(req\) \{([\s\S]*?)\n\}/.exec(src)![1]!;
    expect(staticFn).toMatch(/\.put\(/);
    expect(staticFn).toMatch(/caches\.open\(STATIC_CACHE\)/);
    expect(src).toMatch(/const SNAPSHOT_CACHE = '([^']+)'/);
    expect(/const SNAPSHOT_CACHE = '([^']+)'/.exec(src)![1]).toBe(SNAPSHOT_CACHE);
    expect(src).not.toMatch(/\/api/);
    expect(src).toMatch(/req\.method !== 'GET'/);
  });

  it('/_next/static is cache-first, and only an immutable (production) response is kept', async () => {
    const w = await loadWorker(async (req) =>
      req.url.includes('dev') ? new Response('dev', { headers: { 'cache-control': 'no-store' } }) : immutable('chunk'),
    );
    expect(await (await w.dispatch('/_next/static/chunks/a.js'))!.text()).toBe('chunk');
    expect(await (await w.dispatch('/_next/static/chunks/a.js'))!.text()).toBe('chunk');
    expect(w.fetchSpy).toHaveBeenCalledTimes(1); // the second one came from the cache
    await w.dispatch('/_next/static/dev/b.js');
    await w.dispatch('/_next/static/dev/b.js');
    expect(w.fetchSpy).toHaveBeenCalledTimes(3); // a dev chunk is never cached
  });

  it('a navigation goes to the network; offline, the snapshot of THAT page, else the offline page', async () => {
    let online = true;
    const w = await loadWorker(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response('<html>fresh</html>', { headers: { 'content-type': 'text/html' } });
    });
    const snap = await w.caches.api.open(SNAPSHOT_CACHE);
    await snap.put('/dashboard/receiving/11111111-1111-4111-8111-111111111111', new Response('<html>snapshot</html>'));
    const po = '/dashboard/receiving/11111111-1111-4111-8111-111111111111';
    expect(await (await w.dispatch(po, { mode: 'navigate' }))!.text()).toBe('<html>fresh</html>');
    // Online, the worker never stores the page it fetched.
    expect(w.caches.stores.get(SNAPSHOT_CACHE)!.size).toBe(1);
    online = false;
    expect(await (await w.dispatch(`${po}?x=1`, { mode: 'navigate' }))!.text()).toBe('<html>snapshot</html>');
    expect(await (await w.dispatch('/dashboard/receiving/other', { mode: 'navigate' }))!.text()).toBe('/pwa/offline.html');
  });

  it('never intercepts a POST, an API / tRPC call or another origin', async () => {
    const w = await loadWorker(async () => new Response('x'));
    expect(await w.dispatch('/api/trpc/receiving.markGrLine', { method: 'POST' })).toBeNull();
    expect(await w.dispatch('/api/trpc/receiving.getReceipt')).toBeNull();
    expect(await w.dispatch('/scans/abc.jpg')).toBeNull();
    expect(w.fetchSpy).not.toHaveBeenCalled();
  });

  it('the page may snapshot only the receiving board and PO pages', () => {
    expect(snapshotPathAllowed('/dashboard/receiving')).toBe(true);
    expect(snapshotPathAllowed('/dashboard/receiving/11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(snapshotPathAllowed('/dashboard/approvals')).toBe(false);
    expect(snapshotPathAllowed('/api/trpc/receiving.getPo')).toBe(false);
    expect(snapshotPathAllowed('/dashboard/receiving/../approvals')).toBe(false);
  });

  it('activate keeps its three caches and drops older receiver caches', async () => {
    const w = await loadWorker(async () => new Response('x'));
    for (const n of ['rm-receiver-v1', 'rm-receiver-v2', 'rm-receiver-static-v1', SNAPSHOT_CACHE, 'other-app']) await w.caches.api.open(n);
    let done: Promise<unknown> = Promise.resolve();
    w.listeners.activate!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect([...w.caches.stores.keys()].sort()).toEqual(['other-app', 'rm-receiver-snapshot-v1', 'rm-receiver-static-v1', 'rm-receiver-v2']);
  });

  it('manifest scope + start_url stay inside the receiver flow', () => {
    const m = JSON.parse(readFileSync(join(__dirname, '../../public/pwa/manifest.webmanifest'), 'utf8')) as {
      scope: string;
      start_url: string;
      icons: Array<{ src: string }>;
      share_target?: { action: string; method: string };
    };
    expect(m.scope).toBe('/dashboard/receiving');
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.icons.every((i) => i.src.startsWith('/pwa/'))).toBe(true);
    // orderCapture share target: inside the scope, GET only (no body to an authed route).
    expect(m.share_target?.action.startsWith(`${m.scope}/`)).toBe(true);
    expect(m.share_target?.method).toBe('GET');
  });
});
