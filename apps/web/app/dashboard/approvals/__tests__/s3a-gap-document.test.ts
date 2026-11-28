import { describe, expect, it, vi } from 'vitest';

// use-gap-document.ts reads the tRPC React client at import; the pure helper under test never touches it.
vi.mock('@/lib/trpc/client', () => ({ trpc: {} }));

import { DETAIL_SETTLE_MS, DETAIL_STALE_MS, freshInCache } from '../use-gap-document';

/**
 * DS3-04 S3a fix round, spec §5.13: a held J must not fetch every invoice it passes. Only a FRESH cached detail
 * (within DETAIL_STALE_MS of its fetch, not invalidated) skips the J/K settle; a stale copy would be refetched by
 * `useQuery` on mount, so it waits for the settle like an invoice never seen.
 */

const NOW = 1_800_000_000_000;
const state = (o: { data?: unknown; ageMs: number; isInvalidated?: boolean }) => ({
  data: 'data' in o ? o.data : { lines: [] },
  dataUpdatedAt: NOW - o.ageMs,
  isInvalidated: o.isInvalidated ?? false,
});

describe('freshInCache: which cached invoice may show at once', () => {
  it('fetched within the stale time → fresh (no settle, no fetch)', () => {
    expect(freshInCache(state({ ageMs: 0 }), NOW)).toBe(true);
    expect(freshInCache(state({ ageMs: DETAIL_STALE_MS - 1 }), NOW)).toBe(true);
  });
  it('as old as the stale time or older → not fresh: useQuery would refetch it, so it waits for the settle', () => {
    expect(freshInCache(state({ ageMs: DETAIL_STALE_MS }), NOW)).toBe(false);
    expect(freshInCache(state({ ageMs: 5 * 60_000 }), NOW)).toBe(false);
  });
  it('invalidated, never fetched, or no query at all → not fresh', () => {
    expect(freshInCache(state({ ageMs: 10, isInvalidated: true }), NOW)).toBe(false);
    expect(freshInCache(state({ ageMs: 10, data: undefined }), NOW)).toBe(false);
    expect(freshInCache(undefined, NOW)).toBe(false);
    expect(freshInCache(null, NOW)).toBe(false);
  });
  it('a held J across five invoices cached minutes ago and one prefetched just now: only the fresh one skips the settle', () => {
    const passed = [6, 7, 8, 9, 10].map((m) => state({ ageMs: m * 60_000 }));
    passed.push(state({ ageMs: DETAIL_SETTLE_MS }));
    expect(passed.map((s) => freshInCache(s, NOW))).toEqual([false, false, false, false, false, true]);
  });
  it('the stale time is the query’s own (60 s) and longer than the settle', () => {
    expect(DETAIL_STALE_MS).toBe(60_000);
    expect(DETAIL_SETTLE_MS).toBeLessThan(DETAIL_STALE_MS);
  });
});
