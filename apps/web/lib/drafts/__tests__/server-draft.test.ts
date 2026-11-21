import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerDraft, isNetworkFailure, type LocalCopy } from '../serverDraft';

function localCopy<T>(initial: T | null = null): LocalCopy<T> & { v: T | null } {
  const c = {
    v: initial,
    read: () => c.v,
    write: (x: T) => void (c.v = x),
    remove: () => void (c.v = null),
  };
  return c;
}

const conflictErr = () => Object.assign(new Error('stale'), { data: { code: 'CONFLICT' } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('lib/drafts server draft', () => {
  it('loads, then debounces edits into one save and clears the device copy', async () => {
    const save = vi.fn(async () => undefined);
    const local = localCopy<string>();
    const d = createServerDraft({ load: async () => 'server', save, debounceMs: 500, local });
    await d.start();
    expect(d.snapshot()).toMatchObject({ status: 'idle', value: 'server', unsaved: false });
    d.edit('a');
    d.edit('ab');
    expect(local.v).toBe('ab');
    expect(d.snapshot()).toMatchObject({ status: 'dirty', unsaved: true });
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab', { force: false });
    expect(d.snapshot()).toMatchObject({ status: 'saved', unsaved: false });
    expect(local.v).toBeNull();
  });

  it('a CONFLICT is surfaced as state with the server value — never a silent overwrite', async () => {
    let server = 'v1';
    const save = vi.fn(async () => {
      throw conflictErr();
    });
    const d = createServerDraft({ load: async () => server, save, debounceMs: 10, local: localCopy<string>() });
    await d.start();
    server = 'theirs';
    d.edit('mine');
    await vi.advanceTimersByTimeAsync(10);
    expect(d.snapshot()).toMatchObject({ status: 'conflict', value: 'mine', theirs: 'theirs', unsaved: true });
    // No retry loop while in conflict, even on more edits or a flush.
    d.edit('mine2');
    await d.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('`{ conflict }` from save works too; resolve("theirs") takes theirs and drops the device copy', async () => {
    const local = localCopy<string>();
    const d = createServerDraft({
      load: async () => 'v1',
      save: async () => ({ conflict: 'server-v2' }),
      debounceMs: 10,
      local,
    });
    await d.start();
    d.edit('mine');
    await vi.advanceTimersByTimeAsync(10);
    expect(d.snapshot().status).toBe('conflict');
    await d.resolve('theirs');
    expect(d.snapshot()).toMatchObject({ status: 'idle', value: 'server-v2', unsaved: false });
    expect(local.v).toBeNull();
  });

  it('resolve("mine") re-saves with force', async () => {
    const save = vi.fn().mockRejectedValueOnce(conflictErr()).mockResolvedValueOnce(undefined);
    const d = createServerDraft({ load: async () => 'v1', save, debounceMs: 10 });
    await d.start();
    d.edit('mine');
    await vi.advanceTimersByTimeAsync(10);
    await d.resolve('mine');
    expect(save).toHaveBeenLastCalledWith('mine', { force: true });
    expect(d.snapshot()).toMatchObject({ status: 'saved', unsaved: false });
  });

  it('offline keeps the device copy; flush on reconnect sends it', async () => {
    let online = false;
    const save = vi.fn(async () => undefined);
    const local = localCopy<string>();
    const d = createServerDraft({ load: async () => 'v1', save, debounceMs: 10, local, isOnline: () => online });
    await d.start();
    d.edit('typed offline');
    await vi.advanceTimersByTimeAsync(10);
    expect(save).not.toHaveBeenCalled();
    expect(d.snapshot()).toMatchObject({ status: 'offline', unsaved: true });
    expect(local.v).toBe('typed offline');
    online = true;
    await d.flush();
    expect(save).toHaveBeenCalledWith('typed offline', { force: false });
    expect(local.v).toBeNull();
  });

  it('a network failure mid-save reads as offline, not error, and keeps the copy', async () => {
    const local = localCopy<string>();
    const d = createServerDraft({
      load: async () => 'v1',
      save: async () => {
        throw new TypeError('Failed to fetch');
      },
      debounceMs: 10,
      local,
    });
    await d.start();
    d.edit('x');
    await vi.advanceTimersByTimeAsync(10);
    expect(d.snapshot().status).toBe('offline');
    expect(local.v).toBe('x');
    expect(isNetworkFailure(new Error('boom'))).toBe(false);
  });

  it('after a reload an unsent device copy wins over the server value and is re-sent', async () => {
    const save = vi.fn(async () => undefined);
    const local = localCopy<string>('unsent');
    const d = createServerDraft({ load: async () => 'older server', save, debounceMs: 10, local });
    await d.start();
    expect(d.snapshot().value).toBe('unsent');
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledWith('unsent', { force: false });
  });

  it('an edit made while a save is in flight is saved next, not lost', async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined);
    const local = localCopy<string>();
    const d = createServerDraft({ load: async () => '', save, debounceMs: 10, local });
    await d.start();
    d.edit('one');
    await vi.advanceTimersByTimeAsync(10);
    d.edit('one two');
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.snapshot()).toMatchObject({ unsaved: true });
    expect(local.v).toBe('one two');
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenLastCalledWith('one two', { force: false });
    expect(d.snapshot()).toMatchObject({ status: 'saved', unsaved: false });
  });
});
