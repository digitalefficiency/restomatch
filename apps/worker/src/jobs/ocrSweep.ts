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
 *     bad-image failure would only meter and fail again). EXCEPT an original job
 *     refused by the tenant guard ("invoice … not found … refusing to process"):
 *     it read the row before the producer's transaction committed it (the commit
 *     race #72 narrows with a backoff, e.g. the S13 offline-sync path with nobody
 *     watching), never fetched the scan and never metered — so it counts as
 *     "never ran" and gets its one retry. The retry job's own refusal stays on
 *     record (no second retry).
 *   - at most one automatic retry per invoice: the job's dedupe_key
 *     `ocr-sweep-<invoiceId>` is unique, so overlapping sweeps (or two workers)
 *     can't double-enqueue — and the retry job itself counts as "on record".
 *   - the retry keeps the scan's goods receipt. A receiving scan's link to the
 *     receipt it was photographed on lives ONLY in its job (payload.grId —
 *     invoices has no receipt column), and the OCR job holds the match while
 *     that receipt is still being counted (#94). Without it the retry matched
 *     blind: discovery took a same-supplier sibling PO whose receipt was already
 *     closed, and the later submit never repaired it. So the retry carries the
 *     original job's grId (the refused job row is still on record). When there
 *     is no original job at all (the enqueue was lost), the OCR job itself holds
 *     a receipt-less photo scan while its supplier has a receipt being counted
 *     (ocrInvoice.ts, ocrAutoMatchDecision); that receipt's submit matches it.
 *
 * Only tenants on real OCR (ocrInvoice.ts ocrModeFor → 'claude': ANTHROPIC_API_KEY
 * set AND the restaurant in OCR_REAL_RESTAURANT_IDS) are swept. Anyone else's
 * retry could only be refused ('disabled') or re-stub the demo, so with nobody
 * listed the sweep does nothing.
 */
import type { Sql } from '@restomatch/queue';
import { insertJob } from '@restomatch/queue';
import { makeWorker, workerSql, type WorkerJob } from '../queue';
import { claudeOcrRestaurantIds } from './ocrInvoice';

export type OcrSweepJob = { now?: string };

export const OCR_SWEEP_STALE_AFTER_MS = 10 * 60_000;
/** Signed scan URLs live 30 min; leave a margin for the OCR fetch itself. */
export const OCR_SWEEP_MAX_AGE_MS = 25 * 60_000;
/** Max invoices re-enqueued per sweep. */
export const OCR_SWEEP_BATCH = 50;

/** ocrInvoice.ts's tenant-guard refusal: nothing was fetched or metered. */
export const NOT_FOUND_REFUSAL = /not found in restaurant=\S+ — refusing to process/;
/** The same pattern as a Postgres regex over job_queue.last_error. */
const NOT_FOUND_REFUSAL_PG = NOT_FOUND_REFUSAL.source;

export interface OcrSweepResult {
  requeued: string[];
  /** Candidates that lost the dedupe race (another sweep enqueued them first). */
  raced: string[];
}

/**
 * `restaurantIds` = the tenants on real OCR (claudeOcrRestaurantIds); others are
 * never re-enqueued. Defaults to the environment's list (empty = nothing swept).
 */
export async function runOcrSweep(
  sql: Sql,
  now = new Date(),
  restaurantIds: Iterable<string> = claudeOcrRestaurantIds(),
): Promise<OcrSweepResult> {
  const only = [...restaurantIds].map((id) => id.toLowerCase());
  if (only.length === 0) return { requeued: [], raced: [] };
  const staleBefore = new Date(now.getTime() - OCR_SWEEP_STALE_AFTER_MS);
  const notBefore = new Date(now.getTime() - OCR_SWEEP_MAX_AGE_MS);
  const stale = await sql<
    Array<{ id: string; restaurant_id: string; supplier_id: string | null; raw_image_url: string; gr_id: string | null }>
  >`
    SELECT i.id, i.restaurant_id, i.supplier_id, i.raw_image_url,
           -- the receipt the scan was taken on, from its original (refused) job
           (SELECT j.payload->>'grId' FROM job_queue j
             WHERE j.queue = 'ocr-invoice' AND j.payload->>'invoiceId' = i.id::text
               AND j.payload->>'restaurantId' = i.restaurant_id::text AND j.payload->>'grId' IS NOT NULL
             ORDER BY j.id LIMIT 1) AS gr_id
      FROM invoices i
     WHERE i.status = 'ocr_pending'
       AND i.restaurant_id::text = ANY(${sql.array(only)}::text[])
       AND i.raw_image_url ~* '^https?://'
       AND i.created_at < ${staleBefore}
       AND i.created_at >= ${notBefore}
       AND NOT EXISTS (
         SELECT 1 FROM job_queue j
          WHERE j.queue = 'ocr-invoice' AND j.payload->>'invoiceId' = i.id::text
            -- the ORIGINAL job's commit-race refusal never ran: not "on record"
            AND NOT (
              j.status = 'failed'
              AND j.dedupe_key IS DISTINCT FROM ('ocr-sweep-' || i.id::text)
              AND coalesce(j.last_error, '') ~ ${NOT_FOUND_REFUSAL_PG}
            )
       )
     ORDER BY i.created_at
     LIMIT ${OCR_SWEEP_BATCH}`;

  const result: OcrSweepResult = { requeued: [], raced: [] };
  for (const inv of stale) {
    const inserted = await insertJob(
      sql,
      'ocr-invoice',
      {
        restaurantId: inv.restaurant_id,
        invoiceId: inv.id,
        supplierId: inv.supplier_id,
        imageUrl: inv.raw_image_url,
        ...(inv.gr_id ? { grId: inv.gr_id } : {}),
      },
      { restaurantId: inv.restaurant_id, dedupeKey: `ocr-sweep-${inv.id}` },
    );
    (inserted ? result.requeued : result.raced).push(inv.id);
  }
  return result;
}

export function startOcrSweepWorker() {
  return makeWorker<OcrSweepJob>('ocr-sweep', processOcrSweep);
}

/** The ocr-sweep job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processOcrSweep(job: WorkerJob<OcrSweepJob>) {
  const only = claudeOcrRestaurantIds();
  if (only.size === 0) return { skipped: 'no tenant on real OCR (ANTHROPIC_API_KEY + OCR_REAL_RESTAURANT_IDS)' };
  const result = await runOcrSweep(workerSql(), job.data.now ? new Date(job.data.now) : new Date(), only);
  if (result.requeued.length) console.log(`[ocr-sweep] ${JSON.stringify(result)}`);
  return result;
}
