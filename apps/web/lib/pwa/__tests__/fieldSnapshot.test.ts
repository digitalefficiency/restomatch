import { afterEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_CACHE, SNAPSHOT_OWNER_PATH, purgeFieldSnapshot, refreshFieldSnapshot } from '../fieldSnapshot';

const PO1 = '/dashboard/receiving/11111111-1111-4111-8111-111111111111';
const PO2 = '/dashboard/receiving/22222222-2222-4222-8222-222222222222';

function installCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const path = (r: Request | string) => (typeof r === 'string' ? r : new URL(r.url).pathname);
  vi.stubGlobal('caches', {
    open: async (n: string) => {
      if (!stores.has(n)) stores.set(n, new Map());
      const m = stores.get(n)!;
      return {
        match: async (r: Request | string) => m.get(path(r))?.clone(),
        put: async (r: Request | string, res: Response) => void m.set(path(r), res),
        keys: async () => [...m.keys()].map((p) => new Request(`https://app.test${p}`)),
        delete: async (r: Request | string) => m.delete(path(r)),
      };
    },
    delete: async (n: string) => stores.delete(n),
  });
  return stores;
}

const html = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('field snapshot (offline read copy of today’s deliveries)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores only allowed receiving pages, stamped with their owner', async () => {
    const stores = installCaches();
    vi.stubGlobal('fetch', vi.fn(async (p: string) => html(`page ${p}`)));
    const n = await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, ['/dashboard/receiving', PO1, '/dashboard/approvals']);
    expect(n).toBe(2);
    const snap = stores.get(SNAPSHOT_CACHE)!;
    expect([...snap.keys()].sort()).toEqual(['/dashboard/receiving', PO1, SNAPSHOT_OWNER_PATH].sort());
    expect(await snap.get(SNAPSHOT_OWNER_PATH)!.clone().text()).toBe('u1:r1');
  });

  it('another user (or branch) never reads the previous snapshot: it is wiped first', async () => {
    const stores = installCaches();
    vi.stubGlobal('fetch', vi.fn(async (p: string) => html(p)));
    await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO1]);
    await refreshFieldSnapshot({ userId: 'u2', restaurantId: 'r1' }, [PO2]);
    const snap = stores.get(SNAPSHOT_CACHE)!;
    expect(snap.has(PO1)).toBe(false);
    expect(snap.has(PO2)).toBe(true);
    expect(await snap.get(SNAPSHOT_OWNER_PATH)!.clone().text()).toBe('u2:r1');
  });

  it('a page that left today’s list leaves the snapshot', async () => {
    const stores = installCaches();
    vi.stubGlobal('fetch', vi.fn(async (p: string) => html(p)));
    await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO1, PO2]);
    await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO2]);
    expect(stores.get(SNAPSHOT_CACHE)!.has(PO1)).toBe(false);
  });

  it('signed out while refreshing (401 / redirect to login): nothing of the user stays', async () => {
    const stores = installCaches();
    vi.stubGlobal('fetch', vi.fn(async (p: string) => html(p)));
    await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO1]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    expect(await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO1])).toBe(0);
    expect(stores.has(SNAPSHOT_CACHE)).toBe(false);
  });

  it('sign-out purges it', async () => {
    const stores = installCaches();
    vi.stubGlobal('fetch', vi.fn(async (p: string) => html(p)));
    await refreshFieldSnapshot({ userId: 'u1', restaurantId: 'r1' }, [PO1]);
    await purgeFieldSnapshot();
    expect(stores.has(SNAPSHOT_CACHE)).toBe(false);
  });
});
