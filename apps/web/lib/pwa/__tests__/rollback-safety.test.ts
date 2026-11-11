import { describe, expect, it, vi } from 'vitest';
import { clearMineOnDevice, legacyPhotoMirror, migrateLegacyPhotos, outboxPhotoStore, type LegacyPhotoStore } from '../fieldOutbox';
import { processQueue, type QueuedPhoto } from '../offlineQueue';
import { memoryOutboxStore, withMirrors } from '../outbox';

/**
 * Owner order 7.11 (rollback safety): the W1 queue ("restomatch-receiver" /
 * "photos") is never emptied by the migration. It is copied forward, and every
 * outbox photo write / delete is mirrored back, so at ANY moment it holds exactly
 * the photos not yet sent, and a W1 build rolled back onto this phone uploads
 * those, and never one this build already sent.
 */
function memoryLegacy(seed: QueuedPhoto[] = []): LegacyPhotoStore & { rows: Map<string, QueuedPhoto> } {
  const rows = new Map(seed.map((p) => [p.clientUploadId, { ...p }]));
  return {
    rows,
    list: async () => [...rows.values()].map((p) => ({ ...p })),
    put: async (p) => void rows.set(p.clientUploadId, { ...p }),
    remove: async (id) => void rows.delete(id),
  };
}

const A = { restaurantId: 'rest-a', userId: 'u-1' };
const photo = (id: string, who = A): QueuedPhoto => ({
  clientUploadId: id,
  restaurantId: who.restaurantId,
  userId: who.userId,
  capturedByName: null,
  poId: 'po',
  supplierId: 'sup',
  supplierName: 'ספק',
  mimeType: 'image/jpeg',
  blob: new Blob([new Uint8Array([1])]),
  createdAt: 1,
  attempts: 0,
  lastError: null,
});

/** This build's stores: the outbox, mirrored into the W1 queue. */
function stores(seed: QueuedPhoto[] = []) {
  const legacy = memoryLegacy(seed);
  const outbox = withMirrors(memoryOutboxStore(), [legacyPhotoMirror(legacy)]);
  return { legacy, outbox, photos: outboxPhotoStore(outbox) };
}

describe('rollback safety: the W1 photo queue stays true', () => {
  it('the migration copies forward and deletes NOTHING from the W1 queue', async () => {
    const { legacy, outbox } = stores([photo('p1'), photo('p2')]);
    expect(await migrateLegacyPhotos(outbox, legacy)).toBe(2);
    expect([...legacy.rows.keys()].sort()).toEqual(['p1', 'p2']);
    expect((await outbox.list()).map((i) => i.key).sort()).toEqual(['photo:p1', 'photo:p2']);
    // Idempotent, and it never overwrites the outbox's newer copy.
    await outbox.put({ ...(await outbox.get('photo:p1'))!, attempts: 3 });
    expect(await migrateLegacyPhotos(outbox, legacy)).toBe(0);
    expect((await outbox.get('photo:p1'))!.attempts).toBe(3);
  });

  it('after this build sends p1, a rolled-back W1 build finds exactly p2: nothing lost, nothing sent twice', async () => {
    const { legacy, outbox, photos } = stores([photo('p1'), photo('p2')]);
    await migrateLegacyPhotos(outbox, legacy);
    const upload = vi.fn().mockResolvedValueOnce({ invoiceId: 'i1' }).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await processQueue(photos, upload, () => true, A);
    expect(upload).toHaveBeenCalledTimes(2);
    // ROLLBACK: the W1 build reads only its own store.
    expect([...legacy.rows.keys()]).toEqual(['p2']);
  });

  it('a photo captured by THIS build is also in the W1 queue, so a rollback still uploads it', async () => {
    const { legacy, photos } = stores();
    await photos.put(photo('new-1'));
    expect(legacy.rows.get('new-1')).toMatchObject({ clientUploadId: 'new-1', restaurantId: 'rest-a', attempts: 0 });
    // This build's attempt bookkeeping reaches W1 too (W1 reads the same fields).
    await photos.put({ ...photo('new-1'), attempts: 2, lastError: 'retryable' });
    expect(legacy.rows.get('new-1')).toMatchObject({ attempts: 2, lastError: 'retryable' });
  });

  it("an explicit delete by the user (sign-out → delete mine) leaves the W1 queue too; a colleague's stays", async () => {
    const { legacy, outbox } = stores([photo('mine'), photo('theirs', { restaurantId: 'rest-a', userId: 'u-2' })]);
    await migrateLegacyPhotos(outbox, legacy);
    await clearMineOnDevice('u-1', outbox);
    expect([...legacy.rows.keys()]).toEqual(['theirs']);
  });

  it('a failing mirror never fails the outbox write (the photo is safe in the outbox)', async () => {
    const broken: LegacyPhotoStore = { list: async () => [], put: () => Promise.reject(new Error('quota')), remove: async () => {} };
    const outbox = withMirrors(memoryOutboxStore(), [legacyPhotoMirror(broken)]);
    await outboxPhotoStore(outbox).put(photo('p9'));
    expect(await outbox.get('photo:p9')).toBeDefined();
  });
});
