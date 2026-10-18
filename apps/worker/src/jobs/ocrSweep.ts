/**
 * OCR retry sweep (wave 1).
 *
 * An invoice stays `ocr_pending` forever when its ocr-invoice job never ran:
 * the enqueue timed out while Redis was down (EN-7 — the invoice is kept and the
 * wizard says OCR wasn't queued), the job was lost, or it failed every attempt.
 * Every 5 minutes (cron.ts) this re-enqueues such invoices ONCE:
 *
 *   - stale = `ocr_pending`, created 10–25 minutes ago, with a scan URL. The
 *     upper bound is the scan's signed-URL lifetime (30 min, routers/scans.ts):
 *     an older URL can't be fetched any more, and re-signing needs storage
 *     credentials the worker doesn't hold — those stay for a human (the daily
 *     health digest lists invoices pending > 30 min).
 *   - only invoices with NO ocr-invoice job on record: one still waiting / active /
 *     delayed is a backlog, not a lost job; one that failed or completed already
 *     ran (and was metered) — retrying a quota / inactive-subscription / bad-image
 *     failure would only meter and fail again. Those go to the digest instead.
 *   - only http(s) scan URLs (never stub / smoke rows like `smoke://…`), so a
 *     retry can't turn a mock-provider job into a paid call.
 *   - at most one automatic retry per invoice: a Redis `SET NX` marker (7 days),
 *     plus a deterministic jobId, so overlapping sweeps can't double-enqueue.
 *
 * Without ANTHROPIC_API_KEY a retry could only fail (the original job may have
 * carried dev stub results), so the sweep does nothing.
 */
import { and, eq, gte, invoices, isNotNull, lt, type Database } from '@restomatch/db';
import type { OcrInvoiceJob } from '@restomatch/types';
import type IORedis from 'ioredis';
import { jobDb } from '../db';
import { connection, makeQueue, makeWorker } from '../queue';

export type OcrSweepJob = { now?: string };

export const OCR_SWEEP_STALE_AFTER_MS = 10 * 60_000;
/** Signed scan URLs live 30 min; leave a margin for the OCR fetch itself. */
export const OCR_SWEEP_MAX_AGE_MS = 25 * 60_000;
export const OCR_SWEEP_MARKER_TTL_SEC = 7 * 24 * 3600;
/** Max invoices re-enqueued per sweep. */
export const OCR_SWEEP_BATCH = 50;
const PENDING_STATES = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'];
/** Jobs that already ran; the newest of these are checked too. */
const FINISHED_STATES = ['failed', 'completed'];
/** Above this many pending ocr-invoice jobs the sweep can't cheaply dedupe — it waits. */
const PENDING_SCAN_LIMIT = 1_000;
const HTTP_URL = /^https?:\/\//i;

/** The slice of a BullMQ Queue the sweep uses (tests pass a fake). */
export interface OcrSweepQueue {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getJobs(types: string[], start?: number, end?: number): Promise<Array<{ data?: Partial<OcrInvoiceJob> } | undefined>>;
  add(name: string, data: OcrInvoiceJob, opts?: { jobId?: string }): Promise<unknown>;
}

/** "Has this invoice already had its automatic retry?" — claim returns true once. */
export interface RetryMarker {
  claim(invoiceId: string): Promise<boolean>;
  release(invoiceId: string): Promise<void>;
}

export function redisRetryMarker(redis: Pick<IORedis, 'set' | 'del'>): RetryMarker {
  const key = (invoiceId: string) => `ocr-sweep:retried:${invoiceId}`;
  return {
    async claim(invoiceId) {
      return (await redis.set(key(invoiceId), '1', 'EX', OCR_SWEEP_MARKER_TTL_SEC, 'NX')) === 'OK';
    },
    async release(invoiceId) {
      await redis.del(key(invoiceId));
    },
  };
}

export interface OcrSweepResult {
  requeued: string[];
  skipped: Array<{ invoiceId: string; reason: 'queued' | 'already-ran' | 'already-retried' | 'not-http' }>;
  pendingJobs: number;
  note?: string;
}

export async function runOcrSweep(
  db: Database,
  queue: OcrSweepQueue,
  marker: RetryMarker,
  now = new Date(),
): Promise<OcrSweepResult> {
  const counts = await queue.getJobCounts(...PENDING_STATES);
  const pendingJobs = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  if (pendingJobs > PENDING_SCAN_LIMIT) {
    return { requeued: [], skipped: [], pendingJobs, note: 'ocr-invoice backlog too large — not sweeping' };
  }
  const jobs = pendingJobs ? await queue.getJobs(PENDING_STATES, 0, PENDING_SCAN_LIMIT - 1) : [];
  const queued = new Set(jobs.map((j) => j?.data?.invoiceId).filter(Boolean));
  const finished = await queue.getJobs(FINISHED_STATES, 0, PENDING_SCAN_LIMIT - 1);
  const ran = new Set(finished.map((j) => j?.data?.invoiceId).filter(Boolean));

  const stale = await db
    .select({
      id: invoices.id,
      restaurantId: invoices.restaurantId,
      supplierId: invoices.supplierId,
      imageUrl: invoices.rawImageUrl,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'ocr_pending'),
        isNotNull(invoices.rawImageUrl),
        lt(invoices.createdAt, new Date(now.getTime() - OCR_SWEEP_STALE_AFTER_MS)),
        gte(invoices.createdAt, new Date(now.getTime() - OCR_SWEEP_MAX_AGE_MS)),
      ),
    )
    .orderBy(invoices.createdAt)
    .limit(OCR_SWEEP_BATCH);

  const result: OcrSweepResult = { requeued: [], skipped: [], pendingJobs };
  for (const inv of stale) {
    if (queued.has(inv.id)) {
      result.skipped.push({ invoiceId: inv.id, reason: 'queued' });
      continue;
    }
    if (ran.has(inv.id)) {
      result.skipped.push({ invoiceId: inv.id, reason: 'already-ran' });
      continue;
    }
    if (!HTTP_URL.test(inv.imageUrl ?? '')) {
      result.skipped.push({ invoiceId: inv.id, reason: 'not-http' });
      continue;
    }
    if (!(await marker.claim(inv.id))) {
      result.skipped.push({ invoiceId: inv.id, reason: 'already-retried' });
      continue;
    }
    try {
      await queue.add(
        'ocr-invoice',
        { restaurantId: inv.restaurantId, invoiceId: inv.id, supplierId: inv.supplierId, imageUrl: inv.imageUrl! },
        { jobId: `ocr-sweep-${inv.id}` },
      );
    } catch (err) {
      await marker.release(inv.id); // the retry didn't happen — let the next sweep try
      throw err;
    }
    result.requeued.push(inv.id);
  }
  return result;
}

export function startOcrSweepWorker() {
  const ocrQueue = makeQueue<OcrInvoiceJob>('ocr-invoice') as unknown as OcrSweepQueue;
  const marker = redisRetryMarker(connection);
  return makeWorker<OcrSweepJob>('ocr-sweep', async (job) => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY unset — retries could only fail' };
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const result = await runOcrSweep(jobDb(url), ocrQueue, marker, job.data.now ? new Date(job.data.now) : new Date());
    if (result.requeued.length || result.note) console.log(`[ocr-sweep] ${JSON.stringify(result)}`);
    return result;
  });
}
