import { describe, expect, it } from 'vitest';
import { MAX_AUTO_ATTEMPTS, processQueue, type QueueStore, type QueuedPhoto } from '../pwa/offlineQueue';

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
    expect(r).toEqual({ uploaded: ['a', 'b'], failed: [], remaining: 0 });
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
    expect(store.map.get('a')!.attempts).toBe(1);
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
});
