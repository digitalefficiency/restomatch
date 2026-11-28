import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../../../app/receiver-sw.js/route';
import { POST as receivePost, GET as receiveGet } from '../../../app/dashboard/share/receive/route';
import { claimSharesFor, readShare, routeShare, shareText, takeShareFiles, isShareId, type CacheLike, type CacheStorageLike } from '../shareInbox';
import { purgeFieldSnapshot } from '../fieldSnapshot';
import { MANIFEST_BASE, manifestFor } from '../manifest';

const ORIGIN = 'https://app.test';

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
      match: async () => undefined,
    },
  };
}

async function loadWorker(scope = `${ORIGIN}/dashboard/`) {
  const src = await GET().text();
  const listeners: Record<string, (e: unknown) => void> = {};
  const c = fakeCaches();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const badge = { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
  let windows: Array<{ url: string; focus: () => Promise<unknown>; navigate: (u: string) => Promise<unknown> }> = [];
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
      matchAll: async () => windows,
      openWindow: async (u: string) => void opened.push(u),
    },
  };
  runInNewContext(src, { self, caches: c.api, fetch: vi.fn(), URL, Request, Response, Promise, console, Uint8Array, Array, String, Date, JSON });
  const run = async (type: string, event: Record<string, unknown>) => {
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
  return { run, caches: c, shown, opened, badge, setWindows: (w: typeof windows) => void (windows = w) };
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
    expect(await claimSharesFor('owner-1', api)).toBe(false);
    expect(await claimSharesFor('owner-1', api)).toBe(false);
    expect((await readShare(id, open))?.files).toHaveLength(1);

    // A receiver signs in next (no sign-out in between): the owner's share is gone before anything reads it.
    expect(await claimSharesFor('receiver-2', api)).toBe(true);
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
  it('the app-wide registration never answers a navigation; the receiving one keeps the offline shell', async () => {
    const app = await loadWorker();
    const nav = (w: Awaited<ReturnType<typeof loadWorker>>, path: string) =>
      w.run('fetch', { request: { url: ORIGIN + path, method: 'GET', mode: 'navigate' } });
    expect(await nav(app, '/dashboard/chain')).toBeNull();
    expect(await nav(app, '/dashboard/receiving')).toBeNull(); // a bookkeeper's 403 stays a 403
    const shell = await loadWorker(`${ORIGIN}/dashboard/receiving`);
    expect(await nav(shell, '/dashboard/receivingx')).toBeNull();
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

  it('a click focuses an open window on the exact card, else opens one', async () => {
    const w = await loadWorker();
    const close = vi.fn();
    await w.run('notificationclick', { notification: { close, data: { url: '/dashboard/approvals?invoice=1' } } });
    expect(close).toHaveBeenCalled();
    expect(w.opened).toEqual(['/dashboard/approvals?invoice=1']);

    const navigate = vi.fn(async () => null);
    const win = { url: `${ORIGIN}/dashboard`, focus: async () => win, navigate };
    w.setWindows([win]);
    await w.run('notificationclick', { notification: { close, data: { url: '/dashboard/receiving/9' } } });
    expect(navigate).toHaveBeenCalledWith('/dashboard/receiving/9');
  });
});

describe('app-wide manifest (W3-03b)', () => {
  const m = JSON.parse(readFileSync(join(__dirname, '../../../public/pwa/manifest.webmanifest'), 'utf8'));
  it('the static file is the base: id kept, whole dashboard in scope, start_url inside it, no shortcuts', () => {
    expect(m).toEqual(JSON.parse(JSON.stringify(MANIFEST_BASE)));
    expect(m.id).toBe('/dashboard/receiving');
    expect(m.scope).toBe('/dashboard/');
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.shortcuts).toBeUndefined();
  });
  it('shares by POST multipart (images, PDF, text) to the receive route', () => {
    expect(m.share_target).toMatchObject({ action: '/dashboard/share/receive', method: 'POST', enctype: 'multipart/form-data' });
    expect(m.share_target.params.files[0].accept).toEqual(['image/*', 'application/pdf']);
  });
  it('offers each role only the shortcuts it can open (no 403, no money screen for chef/receiver)', () => {
    const names = (role: Parameters<typeof manifestFor>[0] extends infer V ? (V extends { role: infer R } ? R : never) : never, features: string[] = ['inventoryCount']) =>
      (manifestFor({ role, features }) as { shortcuts?: Array<{ name: string; url: string }> }).shortcuts?.map((s) => s.name) ?? [];
    expect(names('owner')).toEqual(['קבלת משלוח', 'ספירה', 'הזמנה חדשה', 'אישורים']);
    expect(names('receiver')).toEqual(['קבלת משלוח']);
    expect(names('chef')).toEqual(['ספירה', 'הזמנה חדשה']);
    expect(names('bookkeeper')).toEqual(['ספירה', 'אישורים']);
    expect(manifestFor(null)).not.toHaveProperty('shortcuts');
    for (const s of (manifestFor({ role: 'owner', features: ['inventoryCount'] }) as { shortcuts: Array<{ url: string }> }).shortcuts) {
      expect(s.url.startsWith(MANIFEST_BASE.scope)).toBe(true);
    }
  });
});

describe('worker registrations (W3-03b)', () => {
  it('app-wide at /dashboard/, the offline shell at /dashboard/receiving; never throws', async () => {
    const { registerAppWorker, registerReceivingWorker } = await import('../registerWorker');
    const register = vi.fn(async () => ({}));
    expect(await registerAppWorker({ register })).toBe(true);
    expect(await registerReceivingWorker({ register })).toBe(true);
    expect(register.mock.calls).toEqual([
      ['/receiver-sw.js', { scope: '/dashboard/' }],
      ['/receiver-sw.js', { scope: '/dashboard/receiving' }],
    ]);
    expect(await registerAppWorker(undefined)).toBe(false);
    expect(await registerAppWorker({ register: async () => Promise.reject(new Error('x')) })).toBe(false);
  });
});
