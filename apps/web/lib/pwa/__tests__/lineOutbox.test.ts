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
