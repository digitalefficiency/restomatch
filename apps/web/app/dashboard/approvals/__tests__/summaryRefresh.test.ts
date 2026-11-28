import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { makeSummaryRefresher } from '../summaryRefresh';

/**
 * e2e W1-07 "10 s undo that really reopens" (count 8 instead of 9): the undo's
 * summary refresh overlapped the approve's still-in-flight refresh, react-query
 * deduped it onto that request, and the seq guard accepted the stale count. With
 * a REAL QueryClient: the overlap is forced, and the second refresh must start
 * its own request and land the server's latest number.
 */
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ['approvals', 'queueSummary', {}];
  // The server's count, changed by the decisions; each request resolves when released.
  let serverCount = 9;
  const pending: Array<() => void> = [];
  let requests = 0;
  const queryFn = ({ signal }: { signal: AbortSignal }) =>
    new Promise<{ count: number }>((resolve, reject) => {
      requests += 1;
      const snapshot = serverCount; // the count at the moment the request ran
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      pending.push(() => resolve({ count: snapshot }));
    });
  const applied: number[] = [];
  const refresh = makeSummaryRefresher({
    cancel: () => client.cancelQueries({ queryKey: key }),
    fetch: () => client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 }),
    apply: (v) => applied.push(v.count),
  });
  return {
    client,
    refresh,
    applied,
    setServer: (n: number) => (serverCount = n),
    release: () => pending.splice(0).forEach((r) => r()),
    requests: () => requests,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('approvals summary refresh: an overlapping refresh never lands a stale count', () => {
  it('approve refresh in flight (8) + undo refresh → a NEW request; the tiles land on 9', async () => {
    const h = harness();
    h.setServer(8); // approve committed
    const approve = h.refresh();
    await tick();
    h.setServer(9); // undo committed while the approve's refresh is still in flight
    const undo = h.refresh();
    await tick();
    expect(h.requests()).toBe(2); // not deduped onto the stale request
    h.release();
    await Promise.all([approve, undo]);
    expect(h.applied).toEqual([9]);
  });

  it('without the cancel, react-query would dedup (the bug this guards against)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['k'];
    let calls = 0;
    let release!: () => void;
    const queryFn = () => new Promise<number>((r) => { calls += 1; release = () => r(8); });
    const first = client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 });
    const second = client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 });
    release();
    expect(await second).toBe(8);
    expect(await first).toBe(8);
    expect(calls).toBe(1);
  });

  it('two refreshes in order still keep only the newest result', async () => {
    const h = harness();
    h.setServer(5);
    const a = h.refresh();
    await tick();
    h.setServer(4);
    const b = h.refresh();
    await tick();
    h.release();
    await Promise.all([a, b]);
    expect(h.applied).toEqual([4]);
  });

  it('a failed refresh keeps the optimistic numbers (nothing applied, no throw)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const applied: number[] = [];
    const refresh = makeSummaryRefresher({
      cancel: () => client.cancelQueries({ queryKey: ['x'] }),
      fetch: () => client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(new Error('500')), staleTime: 0 }),
      apply: (v: number) => applied.push(v),
    });
    await expect(refresh()).resolves.toBeUndefined();
    expect(applied).toEqual([]);
  });
});
