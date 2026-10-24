import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, invoices, restaurants, testDbUrl } from '@restomatch/db';
import type { OcrInvoiceJob } from '@restomatch/types';
import IORedis from 'ioredis';
import { redisRetryMarker, runOcrSweep, type OcrSweepQueue, type RetryMarker } from '../jobs/ocrSweep';

const db = createDb(testDbUrl());
const NOW = new Date('2026-10-18T09:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
let restaurantId = '';
const ids: Record<string, string> = {};

function fakeQueue(pendingInvoiceIds: string[] = [], pendingCount = pendingInvoiceIds.length, finishedInvoiceIds: string[] = []) {
  const added: Array<{ data: OcrInvoiceJob; jobId?: string }> = [];
  const q: OcrSweepQueue & { added: typeof added } = {
    added,
    getJobCounts: async () => ({ waiting: pendingCount }),
    getJobs: async (types) =>
      (types.includes('failed') ? finishedInvoiceIds : pendingInvoiceIds).map((invoiceId) => ({ data: { invoiceId } })),
    add: async (_name, data, opts) => {
      added.push({ data, jobId: opts?.jobId });
      return {};
    },
  };
  return q;
}

/** In-memory stand-in for the Redis SET NX marker. */
function memoryMarker(): RetryMarker {
  const seen = new Set<string>();
  return {
    claim: async (id) => (seen.has(id) ? false : (seen.add(id), true)),
    release: async (id) => void seen.delete(id),
  };
}

const mine = (list: string[]) => list.filter((id) => Object.values(ids).includes(id));

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: 'OCR sweep QA' }).returning({ id: restaurants.id });
  restaurantId = r!.id;
  const rows = [
    ['stale', 'ocr_pending', 15, 'https://x.example/scan-stale.jpg'],
    ['fresh', 'ocr_pending', 5, 'https://x.example/scan-fresh.jpg'],
    ['expired', 'ocr_pending', 40, 'https://x.example/scan-old.jpg'], // signed URL no longer valid
    ['noImage', 'ocr_pending', 15, null],
    ['done', 'matched', 15, 'https://x.example/scan-done.jpg'],
    ['queued', 'ocr_pending', 12, 'https://x.example/scan-queued.jpg'],
    ['failedBefore', 'ocr_pending', 14, 'https://x.example/scan-failed.jpg'], // its job failed (e.g. quota)
    ['smoke', 'ocr_pending', 16, 'smoke://all'], // stub/mock-provider row
  ] as const;
  for (const [key, status, age, url] of rows) {
    const [inv] = await db
      .insert(invoices)
      .values({ restaurantId, source: 'photo', status, rawImageUrl: url, createdAt: minutesAgo(age) })
      .returning({ id: invoices.id });
    ids[key] = inv!.id;
  }
});
afterAll(async () => {
  await db.delete(invoices).where(eq(invoices.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
});

describe('ocr-pending retry sweep', () => {
  it('re-enqueues only stale, unqueued pending invoices whose scan URL is still valid', async () => {
    const q = fakeQueue([ids.queued!], 1, [ids.failedBefore!]);
    const res = await runOcrSweep(db, q, memoryMarker(), NOW);
    expect(mine(res.requeued)).toEqual([ids.stale]);
    const reason = (id: string) => res.skipped.find((s) => s.invoiceId === id)?.reason;
    expect(reason(ids.queued!)).toBe('queued');
    expect(reason(ids.failedBefore!)).toBe('already-ran');
    expect(reason(ids.smoke!)).toBe('not-http');
    const job = q.added.find((a) => a.data.invoiceId === ids.stale)!;
    expect(job.data).toEqual({
      restaurantId,
      invoiceId: ids.stale,
      supplierId: null,
      imageUrl: 'https://x.example/scan-stale.jpg',
    });
    expect(job.jobId).toBe(`ocr-sweep-${ids.stale}`);
  });

  it('a job refused by the tenant guard (commit race) did not really run: it gets its one retry', async () => {
    const refusal = (id: string) =>
      `[ocr-invoice] invoice=${id} not found in restaurant=${restaurantId} — refusing to process`;
    const added: Array<{ data: OcrInvoiceJob; jobId?: string }> = [];
    const q: OcrSweepQueue = {
      getJobCounts: async () => ({}),
      getJobs: async (types) =>
        types.includes('failed')
          ? [
              { data: { invoiceId: ids.failedBefore! }, failedReason: refusal(ids.failedBefore!) },
              { data: { invoiceId: ids.stale! }, failedReason: 'QuotaExceededError: monthly OCR cap reached' },
            ]
          : [],
      add: async (_name, data, opts) => {
        added.push({ data, jobId: opts?.jobId });
        return {};
      },
    };
    const res = await runOcrSweep(db, q, memoryMarker(), NOW);
    expect(mine(res.requeued)).toContain(ids.failedBefore);
    // Any other failure (quota, bad image…) already ran and was metered: never auto-retried.
    expect(res.skipped.find((x) => x.invoiceId === ids.stale)?.reason).toBe('already-ran');
    expect(added.find((a) => a.data.invoiceId === ids.failedBefore)?.jobId).toBe(`ocr-sweep-${ids.failedBefore}`);
  });

  it('is idempotent: a second sweep does not enqueue the same invoice again', async () => {
    const marker = memoryMarker();
    const q = fakeQueue();
    await runOcrSweep(db, q, marker, NOW);
    const second = await runOcrSweep(db, q, marker, new Date(NOW.getTime() + 5 * 60_000));
    expect(mine(second.requeued)).toEqual([]);
    expect(second.skipped.some((s) => s.invoiceId === ids.stale && s.reason === 'already-retried')).toBe(true);
    expect(q.added.filter((a) => a.data.invoiceId === ids.stale)).toHaveLength(1);
  });

  it('releases the marker when the enqueue fails, so the next sweep retries', async () => {
    const marker = memoryMarker();
    const broken = { ...fakeQueue(), add: async () => Promise.reject(new Error('redis down')) };
    await expect(runOcrSweep(db, broken, marker, NOW)).rejects.toThrow('redis down');
    // The oldest eligible invoice (`stale`) hit the failing add; its marker was released.
    const res = await runOcrSweep(db, fakeQueue(), marker, NOW);
    expect(res.requeued).toContain(ids.stale);
  });

  it('does nothing while the ocr-invoice backlog is too large to dedupe', async () => {
    const q = fakeQueue([], 5_000);
    const res = await runOcrSweep(db, q, memoryMarker(), NOW);
    expect(res.requeued).toEqual([]);
    expect(res.note).toMatch(/backlog/);
    expect(q.added).toHaveLength(0);
  });
});

describe.skipIf(!process.env.REDIS_URL)('redis retry marker', () => {
  it('claims an invoice once, with a TTL', async () => {
    const redis = new IORedis(process.env.REDIS_URL!);
    try {
      const id = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const marker = redisRetryMarker(redis);
      expect(await marker.claim(id)).toBe(true);
      expect(await marker.claim(id)).toBe(false);
      const ttl = await redis.ttl(`ocr-sweep:retried:${id}`);
      expect(ttl).toBeGreaterThan(6 * 24 * 3600);
      await marker.release(id);
      expect(await marker.claim(id)).toBe(true);
      await marker.release(id);
    } finally {
      redis.disconnect();
    }
  });
});
