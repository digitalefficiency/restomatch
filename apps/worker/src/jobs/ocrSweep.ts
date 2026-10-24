/**
 * OCR retry sweep (wave 1).
 *
 * An invoice stays `ocr_pending` forever when its ocr-invoice job never ran:
 * the enqueue timed out while the queue database was unreachable (EN-7 — the
 * invoice is kept and the wizard says OCR wasn't queued) or the job was lost.
 * Every 5 minutes (cron.ts) this re-enqueues such invoices ONCE:
 *
 *   - stale = `ocr_pending`, created 10–25 minutes ago, with an http(s) scan URL.
 *     The upper bound is the scan's signed-URL lifetime (30 min, routers/scans.ts):
 *     an older URL can't be fetched any more, and re-signing needs storage
 *     credentials the worker doesn't hold — those stay for a human (the daily
 *     health digest lists invoices pending > 30 min). http(s) only, so a stub /
 *     smoke row (`smoke://…`) never turns into a paid call.
 *   - only invoices with NO ocr-invoice job on record (pending = a backlog, not a
 *     lost job; failed/done = it already ran and was metered — retrying a quota or
 *     bad-image failure would only meter and fail again).
 *   - at most one automatic retry per invoice: the job's dedupe_key
 *     `ocr-sweep-<invoiceId>` is unique, so overlapping sweeps (or two workers)
 *     can't double-enqueue — and the retry job itself counts as "on record".
 *
 * Without ANTHROPIC_API_KEY a retry could only fail (the original job may have
 * carried dev stub results), so the sweep does nothing.
 */
import type { Sql } from '@restomatch/queue';
import { insertJob } from '@restomatch/queue';
import { makeWorker, workerSql } from '../queue';

export type OcrSweepJob = { now?: string };

export const OCR_SWEEP_STALE_AFTER_MS = 10 * 60_000;
/** Signed scan URLs live 30 min; leave a margin for the OCR fetch itself. */
export const OCR_SWEEP_MAX_AGE_MS = 25 * 60_000;
/** Max invoices re-enqueued per sweep. */
export const OCR_SWEEP_BATCH = 50;

export interface OcrSweepResult {
  requeued: string[];
  /** Candidates that lost the dedupe race (another sweep enqueued them first). */
  raced: string[];
}

export async function runOcrSweep(sql: Sql, now = new Date()): Promise<OcrSweepResult> {
  const staleBefore = new Date(now.getTime() - OCR_SWEEP_STALE_AFTER_MS);
  const notBefore = new Date(now.getTime() - OCR_SWEEP_MAX_AGE_MS);
  const stale = await sql<Array<{ id: string; restaurant_id: string; supplier_id: string | null; raw_image_url: string }>>`
    SELECT i.id, i.restaurant_id, i.supplier_id, i.raw_image_url
      FROM invoices i
     WHERE i.status = 'ocr_pending'
       AND i.raw_image_url ~* '^https?://'
       AND i.created_at < ${staleBefore}
       AND i.created_at >= ${notBefore}
       AND NOT EXISTS (
         SELECT 1 FROM job_queue j
          WHERE j.queue = 'ocr-invoice' AND j.payload->>'invoiceId' = i.id::text
       )
     ORDER BY i.created_at
     LIMIT ${OCR_SWEEP_BATCH}`;

  const result: OcrSweepResult = { requeued: [], raced: [] };
  for (const inv of stale) {
    const inserted = await insertJob(
      sql,
      'ocr-invoice',
      { restaurantId: inv.restaurant_id, invoiceId: inv.id, supplierId: inv.supplier_id, imageUrl: inv.raw_image_url },
      { restaurantId: inv.restaurant_id, dedupeKey: `ocr-sweep-${inv.id}` },
    );
    (inserted ? result.requeued : result.raced).push(inv.id);
  }
  return result;
}

export function startOcrSweepWorker() {
  return makeWorker<OcrSweepJob>('ocr-sweep', async (job) => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY unset — retries could only fail' };
    const result = await runOcrSweep(workerSql(), job.data.now ? new Date(job.data.now) : new Date());
    if (result.requeued.length) console.log(`[ocr-sweep] ${JSON.stringify(result)}`);
    return result;
  });
}
