import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AUTO_ATTEMPTS,
  classifyFailure,
  clearQueue,
  enqueuePhoto,
  isNetworkError,
  isTransientFailure,
  pendingCountOnDevice,
  processQueue,
  resetPersistRequest,
  ScopeChangedError,
  SessionGoneError,
  type QueueStore,
  type QueuedPhoto,
} from '../pwa/offlineQueue';
import { ScanPrepError } from '../scanPrep';

function memStore(items: QueuedPhoto[] = []): QueueStore & { map: Map<string, QueuedPhoto> } {
  const map = new Map(items.map((i) => [i.clientUploadId, i]));
  return {
    map,
    async put(item) {
      map.set(item.clientUploadId, item);
    },
    async list() {
      return [...map.values()];
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

const photo = (id: string, createdAt: number, attempts = 0): QueuedPhoto => ({
  clientUploadId: id,
  restaurantId: 'r1',
  userId: 'u1',
  poId: 'po',
  supplierId: 'sup',
  supplierName: 'ספק',
  mimeType: 'image/jpeg',
  blob: new Blob(['x']),
  createdAt,
  attempts,
  lastError: null,
});

describe('receiver PWA offline queue', () => {
  it('uploads oldest first and removes an item only after its invoice is registered', async () => {
    const store = memStore([photo('b', 2), photo('a', 1)]);
    const seen: string[] = [];
    const r = await processQueue(store, async (item) => {
      seen.push(item.clientUploadId);
      return { invoiceId: `inv-${item.clientUploadId}` };
    });
    expect(seen).toEqual(['a', 'b']);
    expect(r).toEqual({ uploaded: ['a', 'b'], failed: [], remaining: 0, attributed: [], authExpired: false });
  });

  it('re-sends the SAME clientUploadId on retry (idempotent server side) and keeps the item until success', async () => {
    const store = memStore([photo('a', 1)]);
    const ids: string[] = [];
    let fail = true;
    const upload = async (item: QueuedPhoto) => {
      ids.push(item.clientUploadId);
      if (fail) throw new TypeError('Failed to fetch');
      return { invoiceId: 'inv' };
    };
    const first = await processQueue(store, upload);
    expect(first.remaining).toBe(1);
    // A dropped network is not the photo's fault: it costs no attempt (it can never be parked by a bad signal).
    expect(store.map.get('a')!.attempts).toBe(0);
    expect(store.map.get('a')!.lastError).toMatch(/Failed to fetch/);
    fail = false;
    const second = await processQueue(store, upload);
    expect(second.remaining).toBe(0);
    expect(ids).toEqual(['a', 'a']);
  });

  it('stops at the first network error and does nothing while offline', async () => {
    const store = memStore([photo('a', 1), photo('b', 2)]);
    const calls: string[] = [];
    await processQueue(store, async (item) => {
      calls.push(item.clientUploadId);
      throw new TypeError('Failed to fetch');
    });
    expect(calls).toEqual(['a']);
    const offline = await processQueue(store, async () => ({ invoiceId: 'x' }), () => false);
    expect(offline.uploaded).toEqual([]);
    expect(offline.remaining).toBe(2);
  });

  it('a server error on one photo does not block the next; exhausted items are parked, not looped', async () => {
    const store = memStore([photo('bad', 1), photo('good', 2), photo('parked', 3, MAX_AUTO_ATTEMPTS)]);
    const r = await processQueue(store, async (item) => {
      if (item.clientUploadId === 'bad') throw new Error('BAD_REQUEST unsupported mime type');
      return { invoiceId: 'ok' };
    });
    expect(r.uploaded).toEqual(['good']);
    expect(r.failed).toEqual(['bad']);
    expect(r.remaining).toBe(2);
  });

  it("never uploads another restaurant's photo into the active one (shared device)", async () => {
    const store = memStore([photo('mine', 1), { ...photo('theirs', 2), restaurantId: 'r2' }]);
    const seen: string[] = [];
    const r = await processQueue(store, async (i) => (seen.push(i.clientUploadId), { invoiceId: 'x' }), () => true, { restaurantId: 'r1', userId: 'u1' });
    expect(seen).toEqual(['mine']);
    expect(r.remaining).toBe(0);
    expect(store.map.has('theirs')).toBe(true);
  });

  it("S4 I3 (decision 22): a colleague's photo on a shared device uploads, attributed; another branch's never; nothing is wiped", async () => {
    const store = memStore([
      photo('mine', 1),
      { ...photo('colleague', 2), userId: 'u2', capturedByName: 'דנה' },
      { ...photo('other-branch', 3), restaurantId: 'r2', userId: 'u2' },
    ]);
    const seen: string[] = [];
    const r = await processQueue(store, async (i) => (seen.push(i.clientUploadId), { invoiceId: 'x' }), () => true, { restaurantId: 'r1', userId: 'u1' });
    expect(seen).toEqual(['mine', 'colleague']);
    expect(r.attributed).toEqual([{ clientUploadId: 'colleague', capturedByName: 'דנה' }]);
    expect(store.map.has('other-branch')).toBe(true);
    expect(await pendingCountOnDevice(store)).toBe(1);
  });

  it('a 401 or a dropped network consumes NO attempt and stops the run; a 5xx consumes one; a 4xx parks the item', async () => {
    const http = (status: number, code: string) => Object.assign(new Error('x'), { data: { httpStatus: status, code } });
    for (const [err, attempts, stopped] of [
      [http(401, 'UNAUTHORIZED'), 0, true],
      [new TypeError('Failed to fetch'), 0, true],
      [http(503, 'INTERNAL_SERVER_ERROR'), 1, false],
      [http(400, 'BAD_REQUEST'), MAX_AUTO_ATTEMPTS, false],
    ] as const) {
      const store = memStore([photo('a', 1), photo('b', 2)]);
      const calls: string[] = [];
      await processQueue(store, async (i) => {
        calls.push(i.clientUploadId);
        if (i.clientUploadId === 'a') throw err;
        return { invoiceId: 'ok' };
      });
      expect(store.map.get('a')!.attempts, String(err)).toBe(attempts);
      expect(calls, String(err)).toEqual(stopped ? ['a'] : ['a', 'b']);
    }
  });

  it('an expired session stops the run, costs nothing, and says so (authExpired) — a branch switch does not', async () => {
    const unauthorized = Object.assign(new Error('x'), { data: { httpStatus: 401, code: 'UNAUTHORIZED' } });
    for (const [err, expired] of [
      [unauthorized, true],
      [new SessionGoneError(), true],
      [new ScopeChangedError(), false],
    ] as const) {
      const store = memStore([photo('a', 1), photo('b', 2)]);
      const calls: string[] = [];
      const r = await processQueue(store, async (i) => {
        calls.push(i.clientUploadId);
        throw err;
      });
      expect(r.authExpired, String(err)).toBe(expired);
      expect(calls, String(err)).toEqual(['a']);
      expect(store.map.get('a')!.attempts, String(err)).toBe(0);
    }
    expect(classifyFailure(new SessionGoneError(), true)).toBe('auth');
  });

  it('a photo the browser cannot make uploadable (too big / undecodable) is parked at once, not retried', async () => {
    const store = memStore([photo('a', 1), photo('b', 2)]);
    const r = await processQueue(store, async (i) => {
      if (i.clientUploadId === 'a') throw new ScanPrepError('unsupported_type');
      return { invoiceId: 'ok' };
    });
    expect(store.map.get('a')!.attempts).toBe(MAX_AUTO_ATTEMPTS);
    expect(r.uploaded).toEqual(['b']);
    expect(classifyFailure(new ScanPrepError('too_large'), true)).toBe('permanent');
  });

  it('classifies by HTTP status / tRPC code, never by the message text', () => {
    const http = (status: number | undefined, code?: string) => Object.assign(new Error('network is fine'), { data: { httpStatus: status, code } });
    expect(classifyFailure(http(401, 'UNAUTHORIZED'), true)).toBe('auth');
    expect(classifyFailure(http(500, 'INTERNAL_SERVER_ERROR'), true)).toBe('retryable');
    expect(classifyFailure(http(429, 'TOO_MANY_REQUESTS'), true)).toBe('retryable');
    expect(classifyFailure(http(400, 'BAD_REQUEST'), true)).toBe('permanent');
    // A 400 whose message mentions "network" is still a 400.
    expect(classifyFailure(Object.assign(new Error('NetworkError in payload'), { data: { httpStatus: 400, code: 'BAD_REQUEST' } }), true)).toBe('permanent');
    // tRPC client errors: the HTTP status on meta.response, or no response at all (fetch rejected).
    expect(classifyFailure(Object.assign(new Error('x'), { meta: { response: { status: 502 } } }), true)).toBe('retryable');
    expect(classifyFailure(Object.assign(new Error('x'), { cause: new TypeError('Load failed') }), true)).toBe('network');
    expect(classifyFailure(new TypeError('Failed to fetch'), true)).toBe('network');
    expect(classifyFailure(new Error('anything'), false)).toBe('network');
    expect(isNetworkError(http(400, 'BAD_REQUEST'))).toBe(false);
    // A line save that hits a 401 (signed out mid-count) stays "saved on the phone", never "failed".
    expect(isTransientFailure(http(401, 'UNAUTHORIZED'))).toBe(true);
    expect(isTransientFailure(http(400, 'BAD_REQUEST'))).toBe(false);
  });

  it('asks the browser to keep the queue (storage.persist) on the first enqueue only', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { onLine: true, storage: { persist, persisted: async () => false } });
    try {
      resetPersistRequest();
      const store = memStore();
      const item = { ...photo('p', 1) } as Partial<QueuedPhoto>;
      delete item.createdAt;
      delete item.attempts;
      delete item.lastError;
      await enqueuePhoto(item as Parameters<typeof enqueuePhoto>[0], store);
      await enqueuePhoto({ ...(item as Parameters<typeof enqueuePhoto>[0]), clientUploadId: 'q' }, store);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(store.map.size).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clearQueue (deprecated) still empties the device when explicitly called', async () => {
    const store = memStore([photo('a', 1), { ...photo('b', 2), userId: 'u3' }]);
    await clearQueue(store);
    expect(store.map.size).toBe(0);
  });
});
