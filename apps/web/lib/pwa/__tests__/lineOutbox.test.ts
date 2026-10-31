import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLineOutbox, type GrLinePayload, type OutboxStorage } from '../lineOutbox';

const row = (grLineId: string, qtyReceived: number, extra: Partial<GrLinePayload> = {}): GrLinePayload => ({
  grLineId,
  qtyReceived,
  qtyRejected: 0,
  condition: 'ok',
  ...extra,
});

function memoryStorage(initial: GrLinePayload[] = []): OutboxStorage & { items: GrLinePayload[] } {
  const s = {
    items: [...initial],
    load: () => [...s.items],
    save: (items: GrLinePayload[]) => {
      s.items = [...items];
    },
  };
  return s;
}

const netErr = () => new TypeError('Failed to fetch');
const isNetworkError = (e: unknown) => e instanceof TypeError;

describe('lineOutbox (Delivery Check saves on change)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces 300 ms per line and sends only the latest full row', async () => {
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError });
    box.set(row('a', 9));
    box.set(row('a', 8));
    expect(box.states().a).toBe('saving');
    await vi.advanceTimersByTimeAsync(299);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(row('a', 8));
    expect(box.states().a).toBe('saved');
    expect(box.pendingCount()).toBe(0);
  });

  it('records "billed 10, arrived 8" as the full row the server overwrites', async () => {
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError });
    box.set(row('a', 8, { rejectReason: undefined }));
    await box.flush();
    expect(send.mock.calls[0]![0]).toMatchObject({ grLineId: 'a', qtyReceived: 8, qtyRejected: 0, condition: 'ok' });
  });

  it('does not resend an unchanged row', async () => {
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError });
    box.set(row('a', 8));
    await box.flush();
    box.set(row('a', 8));
    await vi.advanceTimersByTimeAsync(400);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('offline: the line is queued on the phone, kept in storage and sent once back online', async () => {
    const storage = memoryStorage();
    const send = vi.fn().mockRejectedValueOnce(netErr()).mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError, storage });
    box.set(row('a', 0, { rejectReason: 'missing' }));
    const r = await box.flush();
    expect(r.queued).toEqual(['a']);
    expect(box.states().a).toBe('queued');
    expect(storage.items).toEqual([row('a', 0, { rejectReason: 'missing' })]);

    await box.retry();
    expect(send).toHaveBeenCalledTimes(2);
    expect(box.states().a).toBe('saved');
    expect(storage.items).toEqual([]);
  });

  it('resume race: a row sent while the server snapshot was loading is still known locally (latest())', async () => {
    // Opened with an unsent row: the retry sends it at once, and the server ACKs
    // before the (older) getReceipt snapshot arrives. The restore overlays
    // latest(), so the count can never fall back to "not counted".
    const storage = memoryStorage([row('a', 8)]);
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError, storage });
    await box.retry();
    expect(box.pending()).toEqual([]);
    expect(box.latest()).toEqual([row('a', 8)]);
    box.set(row('a', 7));
    expect(box.latest()).toEqual([row('a', 7)]);
  });

  it('clear() forgets every unsent row (the receipt was closed)', async () => {
    const storage = memoryStorage([row('a', 8), row('b', 2)]);
    const send = vi.fn().mockRejectedValue(netErr());
    const box = createLineOutbox({ send, isNetworkError, storage });
    box.clear();
    expect(box.pending()).toEqual([]);
    expect(storage.items).toEqual([]);
    await box.retry();
    expect(send).not.toHaveBeenCalled();
  });

  it('a row written before the receipt was closed/reopened is HELD: never sent, never overlaid, kept until apply/discard', async () => {
    // A counted 10 offline on version v1; B closed (v2) and the receipt was reopened (v3).
    const stale = { ...row('a', 10), stamp: { grId: 'gr', version: 'v1' } };
    const fresh = { ...row('b', 3), stamp: { grId: 'gr', version: 'v3' } };
    const storage = memoryStorage([stale, fresh]);
    const send = vi.fn().mockResolvedValue({});
    let current: string | null = null;
    const box = createLineOutbox({
      send,
      isNetworkError,
      storage,
      rowStatus: (p) => (current === null ? 'unknown' : p.stamp?.grId === 'gr' && p.stamp.version === current ? 'current' : 'stale'),
    });
    // The receipt version is not known yet: nothing is sent at all.
    await box.retry();
    expect(send).not.toHaveBeenCalled();
    current = 'v3';
    await box.retry();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(row('b', 3)); // the stamp never reaches the server
    expect(box.states().a).toBe('held');
    expect(box.held()).toEqual([stale]);
    expect(box.latest()).toEqual([row('b', 3)].map((r) => ({ ...r, stamp: fresh.stamp })));
    expect(box.pendingCount()).toBe(0);
    expect(storage.items).toEqual([stale]); // kept on the phone — never silently dropped
    // Discard: gone from the phone.
    box.discard('a');
    expect(box.held()).toEqual([]);
    expect(storage.items).toEqual([]);
  });

  it('applying a held row re-stamps it with the current version and sends it', async () => {
    const stale = { ...row('a', 10), stamp: { grId: 'gr', version: 'v1' } };
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({
      send,
      isNetworkError,
      storage: memoryStorage([stale]),
      rowStatus: (p) => (p.stamp?.version === 'v3' ? 'current' : 'stale'),
    });
    await box.retry();
    expect(box.states().a).toBe('held');
    box.set({ ...row('a', 10), stamp: { grId: 'gr', version: 'v3' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(send).toHaveBeenCalledWith(row('a', 10));
    expect(box.states().a).toBe('saved');
    expect(box.held()).toEqual([]);
  });

  it('a reload restores unsent rows from storage as queued and sends them', async () => {
    const storage = memoryStorage([row('a', 7), row('b', 0, { rejectReason: 'missing' })]);
    const send = vi.fn().mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError, storage });
    expect(box.pendingCount()).toBe(2);
    expect(box.states()).toEqual({ a: 'queued', b: 'queued' });
    expect(box.pending().map((p) => p.grLineId)).toEqual(['a', 'b']);
    await box.retry();
    expect(send).toHaveBeenCalledTimes(2);
    expect(box.pendingCount()).toBe(0);
  });

  it('a server rejection is an error on the line (not queued) and can be retried', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('NOT_FOUND')).mockResolvedValue({});
    const box = createLineOutbox({ send, isNetworkError });
    box.set(row('a', 3));
    const r = await box.flush();
    expect(r.failed).toEqual(['a']);
    expect(box.states().a).toBe('error');
    const again = await box.retry();
    expect(again.failed).toEqual([]);
    expect(box.states().a).toBe('saved');
  });

  it('never lets an older write land after a newer one', async () => {
    const order: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send = vi.fn(async (p: GrLinePayload) => {
      if (p.qtyReceived === 5) await gate;
      order.push(p.qtyReceived);
    });
    const box = createLineOutbox({ send, isNetworkError });
    box.set(row('a', 5));
    await vi.advanceTimersByTimeAsync(300); // first write in flight (blocked)
    box.set(row('a', 6));
    const flushed = box.flush();
    release();
    await flushed;
    expect(order).toEqual([5, 6]);
    expect(box.states().a).toBe('saved');
  });

  it('reports state changes for the per-line "saved" indicator', async () => {
    const seen: string[] = [];
    const box = createLineOutbox({
      send: vi.fn().mockResolvedValue({}),
      isNetworkError,
      onChange: (s) => seen.push(s.a ?? ''),
    });
    box.set(row('a', 1));
    await box.flush();
    expect(seen).toEqual(['saving', 'saved']);
  });
});
