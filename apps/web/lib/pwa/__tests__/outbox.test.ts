import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  OutboxHeldError,
  WARNED_RETENTION_MS,
  backoffMs,
  countOutbox,
  drainOutbox,
  enqueue,
  markWarned,
  memoryOutboxStore,
  outboxKey,
  registerOutboxKind,
  removeItem,
  resetOutboxKinds,
  retryItem,
  sweepExpired,
  type GroupLock,
} from '../outbox';
import {
  GR_LINE_KIND,
  SUBMIT_RECEIPT_KIND,
  clearMineOnDevice,
  countMineOnDevice,
  dropLegacyLine,
  fieldLineStorage,
  legacyLineKeyUser,
  migrateLegacyLines,
  outboxPhotoStore,
} from '../fieldOutbox';
import type { GrLinePayload } from '../lineOutbox';
import { processQueue, type QueuedPhoto } from '../offlineQueue';

const A = { restaurantId: 'rest-a', userId: 'u-1' };
const COLLEAGUE = { restaurantId: 'rest-a', userId: 'u-2', capturedByName: 'דנה' };
const OTHER_BRANCH = { restaurantId: 'rest-b', userId: 'u-1' };

/** An HTTP error shaped like a tRPC client error. */
const httpErr = (status: number, code: string) => Object.assign(new Error(code), { data: { httpStatus: status, code } });
const netErr = () => new TypeError('Failed to fetch');
/** No other tab: every group lock is free. */
const freeLock: GroupLock = async (_n, fn) => {
  await fn();
  return true;
};

const line = (grLineId: string, qty: number, grId = 'gr-1'): GrLinePayload => ({
  grLineId,
  qtyReceived: qty,
  qtyRejected: 0,
  condition: 'ok',
  stamp: { grId, version: 'v1' },
});

/** A localStorage stand-in on `window` (node env). */
function installWindow() {
  const data = new Map<string, string>();
  const ls = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
  vi.stubGlobal('window', { localStorage: ls, dispatchEvent: () => true });
  return data;
}

describe('outbox core (registerOutboxKind / enqueue / drain)', () => {
  let t = 1_000_000;
  const now = () => t;
  beforeEach(() => {
    resetOutboxKinds();
    t = 1_000_000;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a stable key per payload: a second write REPLACES the queued one (latest wins, keeps its age)', async () => {
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: vi.fn() });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 9), A, { now: 1 });
    await enqueue(store, 'grLine', line('l1', 8), A, { now: 5 });
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe(outboxKey('grLine', 'l1'));
    expect((items[0]!.payload as GrLinePayload).qtyReceived).toBe(8);
    expect(items[0]!.createdAt).toBe(1);
    expect(items[0]!.revision).toBe(2);
  });

  it('sends oldest first and removes an item only on the server ack', async () => {
    const sent: string[] = [];
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: async (p) => void sent.push(p.grLineId) });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l2', 1, 'gr-2'), A, { now: 2 });
    await enqueue(store, 'grLine', line('l1', 1, 'gr-1'), A, { now: 1 });
    const r = await drainOutbox(store, { scope: A, now, lock: freeLock });
    expect(sent).toEqual(['l1', 'l2']);
    expect(r.sent).toHaveLength(2);
    expect(r.remaining).toBe(0);
  });

  it('backoff is 2/4/8…60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    expect(BACKOFF_MAX_MS).toBe(60_000);
  });

  it('a retryable failure spends an attempt and backs off; the item stays', async () => {
    const send = vi.fn().mockRejectedValue(httpErr(503, 'INTERNAL_SERVER_ERROR'));
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), A, { now: t });
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    let [item] = await store.list();
    expect(item!.attempts).toBe(1);
    expect(item!.nextAttemptAt).toBe(t + 2_000);
    // Not due yet: not sent again.
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(send).toHaveBeenCalledTimes(1);
    t += 2_000;
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    [item] = await store.list();
    expect(send).toHaveBeenCalledTimes(2);
    expect(item!.attempts).toBe(2);
    expect(item!.nextAttemptAt).toBe(t + 4_000);
  });

  it('a 401 or a network drop costs NO attempt and stops the run', async () => {
    const send = vi.fn().mockRejectedValueOnce(httpErr(401, 'UNAUTHORIZED')).mockRejectedValueOnce(netErr());
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1, 'gr-1'), A, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1, 'gr-2'), A, { now: 2 });
    const r1 = await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(r1.authExpired).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); // stopped: l2 was not tried
    const r2 = await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(r2.offline).toBe(true);
    for (const i of await store.list()) {
      expect(i.attempts).toBe(0);
      expect(i.nextAttemptAt).toBeLessThanOrEqual(t);
    }
  });

  it('a permanent failure (4xx) or a held row parks the item: kept, never auto-sent', async () => {
    const send = vi.fn().mockRejectedValueOnce(httpErr(400, 'BAD_REQUEST')).mockRejectedValueOnce(new OutboxHeldError());
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1, 'gr-1'), A, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1, 'gr-2'), A, { now: 2 });
    const r = await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(r.parked).toHaveLength(2);
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(send).toHaveBeenCalledTimes(2);
    expect((await store.list()).every((i) => i.status === 'parked')).toBe(true);
    // "Try again" re-arms it.
    send.mockResolvedValue({});
    await retryItem(store, outboxKey('grLine', 'l1'), t);
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect((await store.list()).map((i) => i.key)).toEqual([outboxKey('grLine', 'l2')]);
  });

  it("a group goes in order: a receipt's close never overtakes a count that failed", async () => {
    const calls: string[] = [];
    registerOutboxKind('grLine', {
      ...GR_LINE_KIND,
      send: async (p) => {
        calls.push(p.grLineId);
        if (p.grLineId === 'l2') throw httpErr(503, 'INTERNAL_SERVER_ERROR');
      },
    });
    registerOutboxKind('submitReceipt', { ...SUBMIT_RECEIPT_KIND, send: async () => void calls.push('submit') });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), A, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1), A, { now: 2 });
    await enqueue(store, 'submitReceipt', { grId: 'gr-1', clientMutationId: 'm1' }, A, { now: 3 });
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(calls).toEqual(['l1', 'l2']);
    expect((await store.list()).map((i) => i.kind).sort()).toEqual(['grLine', 'submitReceipt']);
  });

  it('a kind without a sender on this page waits (never dropped) and holds its group', async () => {
    const send = vi.fn();
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'submitReceipt', { grId: 'gr-1', clientMutationId: 'm1' }, { ...A, group: 'gr:gr-1' }, { now: 1, idempotencyKey: 'gr-1' });
    await enqueue(store, 'grLine', line('l9', 1), A, { now: 2 });
    const r = await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(send).not.toHaveBeenCalled();
    expect(r.remaining).toBe(2);
  });

  it('a group held by an open screen / another tab is skipped this run', async () => {
    const send = vi.fn().mockResolvedValue({});
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), A, { now: 1 });
    const busy: GroupLock = async () => false;
    const r = await drainOutbox(store, { scope: A, now, lock: busy, isOnline: () => true });
    expect(send).not.toHaveBeenCalled();
    expect(r.remaining).toBe(1);
  });

  it('a write that lands while its older value is in flight is kept and sent next', async () => {
    const store = memoryOutboxStore();
    const sent: number[] = [];
    registerOutboxKind('grLine', {
      ...GR_LINE_KIND,
      send: async (p) => {
        sent.push(p.qtyReceived);
        if (p.qtyReceived === 9) await enqueue(store, 'grLine', line('l1', 7), A, { now: t });
      },
    });
    await enqueue(store, 'grLine', line('l1', 9), A, { now: 1 });
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect((await store.list()).map((i) => (i.payload as GrLinePayload).qtyReceived)).toEqual([7]);
    await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(sent).toEqual([9, 7]);
    expect(await store.list()).toEqual([]);
  });

  it("decision 22: a colleague's item of this restaurant is sent and attributed; another restaurant's waits", async () => {
    const send = vi.fn().mockResolvedValue({});
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1, 'gr-1'), COLLEAGUE, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1, 'gr-2'), OTHER_BRANCH, { now: 2 });
    const r = await drainOutbox(store, { scope: A, now, lock: freeLock, isOnline: () => true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.attributed).toEqual([{ key: outboxKey('grLine', 'l1'), kind: 'grLine', capturedByName: 'דנה' }]);
    expect(r.remaining).toBe(0);
    expect(countOutbox(await store.list(), A)).toMatchObject({ waiting: 0, otherBranch: 1 });
  });

  it('only the user who captured an item may delete it', async () => {
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: vi.fn() });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), COLLEAGUE, { now: 1 });
    expect(await removeItem(store, outboxKey('grLine', 'l1'), { userId: A.userId })).toBe(false);
    expect(await store.list()).toHaveLength(1);
    expect(await removeItem(store, outboxKey('grLine', 'l1'), { userId: COLLEAGUE.userId })).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it('nothing expires unseen: an item goes 14 days after a VISIBLE warning, not before', async () => {
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: vi.fn() });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), A, { now: 0 });
    expect(await sweepExpired(store, 10 * WARNED_RETENTION_MS)).toEqual([]); // never shown: kept
    await markWarned(store, [outboxKey('grLine', 'l1')], 100);
    await markWarned(store, [outboxKey('grLine', 'l1')], 999); // the clock starts once
    expect(await sweepExpired(store, 100 + WARNED_RETENTION_MS - 1)).toEqual([]);
    expect(await sweepExpired(store, 100 + WARNED_RETENTION_MS)).toEqual([outboxKey('grLine', 'l1')]);
  });

  it('countOutbox splits mine / colleagues / another branch / parked', async () => {
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: vi.fn() });
    const store = memoryOutboxStore();
    await enqueue(store, 'grLine', line('l1', 1), A, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1), COLLEAGUE, { now: 2 });
    await enqueue(store, 'grLine', line('l3', 1), OTHER_BRANCH, { now: 3 });
    expect(countOutbox(await store.list(), A)).toEqual({ waiting: 2, mine: 1, colleagues: 1, otherBranch: 1, parked: 0 });
  });
});

describe('photo kind: the W1 photo queue lives in the outbox', () => {
  const photo = (id: string, who = A): QueuedPhoto => ({
    clientUploadId: id,
    restaurantId: who.restaurantId,
    userId: who.userId,
    capturedByName: null,
    poId: 'po',
    supplierId: 'sup',
    supplierName: 's',
    mimeType: 'image/jpeg',
    blob: new Blob([new Uint8Array([1])]),
    createdAt: 1,
    attempts: 0,
    lastError: null,
  });

  it('the QueueStore view round-trips through the outbox and processQueue still works on it', async () => {
    const store = memoryOutboxStore();
    const view = outboxPhotoStore(store);
    await view.put(photo('p1'));
    await view.put(photo('p2', COLLEAGUE));
    expect((await store.list()).map((i) => i.key).sort()).toEqual(['photo:p1', 'photo:p2']);
    const upload = vi.fn().mockResolvedValueOnce({ invoiceId: 'i1' }).mockRejectedValueOnce(httpErr(503, 'INTERNAL_SERVER_ERROR'));
    const r = await processQueue(view, upload, () => true, A);
    expect(r.uploaded).toEqual(['p1']);
    const [left] = await view.list();
    expect(left!.clientUploadId).toBe('p2');
    expect(left!.attempts).toBe(1); // processQueue's attempt bookkeeping survives the view
  });

  it('the sign-out guard counts and deletes ONLY this user\'s items, every kind', async () => {
    resetOutboxKinds();
    registerOutboxKind('grLine', { ...GR_LINE_KIND, send: vi.fn() });
    const store = memoryOutboxStore();
    await outboxPhotoStore(store).put(photo('p1'));
    await enqueue(store, 'grLine', line('l1', 1), A, { now: 1 });
    await enqueue(store, 'grLine', line('l2', 1), COLLEAGUE, { now: 2 });
    expect(await countMineOnDevice(A.userId, store)).toEqual({ total: 2, photos: 1 });
    await clearMineOnDevice(A.userId, store);
    expect((await store.list()).map((i) => i.userId)).toEqual([COLLEAGUE.userId]);
  });
});

describe("grLine kind: W1-06's localStorage rows migrate with zero loss", () => {
  beforeEach(() => resetOutboxKinds());
  afterEach(() => vi.unstubAllGlobals());

  it('legacyLineKeyUser reads the user from rm-rcv-lines:<userId>:<poId>', () => {
    expect(legacyLineKeyUser('rm-rcv-lines:u-7:po-1')).toBe('u-7');
    expect(legacyLineKeyUser('rm-rcv-lines:-:po-1')).toBeNull();
    expect(legacyLineKeyUser('rm-rcv-draft:u-7:po-1')).toBeNull();
  });

  it('every stored row becomes one outbox item; the localStorage copy stays until the server acks it', async () => {
    const ls = installWindow();
    ls.set('rm-rcv-lines:u-1:po-1', JSON.stringify([line('l1', 3), line('l2', 0)]));
    ls.set('rm-rcv-lines:u-2:po-2', JSON.stringify([line('l3', 5, 'gr-2')]));
    ls.set('rm-rcv-unordered:u-1:po-1', JSON.stringify({ marks: {} })); // wizard-local marks: not server work
    const store = memoryOutboxStore();
    expect(await migrateLegacyLines(A, store)).toBe(3);
    expect(await migrateLegacyLines(A, store)).toBe(0); // idempotent
    const items = await store.list();
    expect(items.map((i) => i.key).sort()).toEqual(['grLine:l1', 'grLine:l2', 'grLine:l3']);
    expect(items.find((i) => i.key === 'grLine:l3')!.userId).toBe('u-2'); // attributed to whoever counted it
    expect(items.find((i) => i.key === 'grLine:l1')!.group).toBe('gr:gr-1');
    expect(ls.has('rm-rcv-lines:u-1:po-1')).toBe(true);

    // The drainer acks l1: it leaves the outbox and the W1-06 copy; l2 stays in both.
    const sent: string[] = [];
    registerOutboxKind<GrLinePayload>('grLine', {
      ...GR_LINE_KIND,
      send: async (p, item) => {
        sent.push(p.grLineId);
        if (p.grLineId === 'l2') throw netErr();
        dropLegacyLine(item.meta?.legacyKey, p);
      },
    });
    await drainOutbox(store, { scope: A, lock: freeLock, isOnline: () => true });
    expect(sent).toEqual(['l1', 'l2']);
    const left = JSON.parse(ls.get('rm-rcv-lines:u-1:po-1')!) as GrLinePayload[];
    expect(left.map((r) => r.grLineId)).toEqual(['l2']);
    expect((await store.list()).map((i) => i.key).sort()).toEqual(['grLine:l2', 'grLine:l3']);
  });

  it("the wizard's storage mirrors unsent rows into the outbox and drops the mirror once acked", async () => {
    const ls = installWindow();
    const store = memoryOutboxStore();
    const storage = fieldLineStorage('rm-rcv-lines:u-1:po-1', A, store);
    storage.save([line('l1', 3), line('l2', 1)]);
    storage.save([line('l1', 4), line('l2', 1)]);
    await vi.waitFor(async () => expect(await store.list()).toHaveLength(2));
    await vi.waitFor(async () =>
      expect(((await store.get('grLine:l1'))!.payload as GrLinePayload).qtyReceived).toBe(4),
    );
    expect(storage.load().map((r) => r.qtyReceived)).toEqual([4, 1]); // the synchronous copy for an instant resume
    storage.save([line('l2', 1)]); // the screen got l1's ack
    await vi.waitFor(async () => expect((await store.list()).map((i) => i.key)).toEqual(['grLine:l2']));
    storage.save([]); // receipt closed
    await vi.waitFor(async () => expect(await store.list()).toEqual([]));
    expect(ls.has('rm-rcv-lines:u-1:po-1')).toBe(false);
  });
});
