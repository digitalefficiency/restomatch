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
 * Without ANTHROPIC_API_KEY a retry could only fail (the original job may have
 * carried dev stub results), so the sweep does nothing.
 */
import { signObjectRef, toObjectRef } from '@restomatch/api';
import type { Sql } from '@restomatch/queue';
import { insertJob } from '@restomatch/queue';
import { makeWorker, workerSql, type WorkerJob } from '../queue';

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
  /** G-09: held multi-page pages released to the match after the hold cap. */
  released?: string[];
}

/** G-09: a page held for its siblings' OCR is released to the match after this long. */
export const G09_HOLD_MAX_MS = 30 * 60_000;
/** G-09: path-form scans are signed at sweep time, so they have no URL expiry; look back a day. */
export const G09_PATH_MAX_AGE_MS = 24 * 60 * 60_000;

export async function runOcrSweep(sql: Sql, now = new Date()): Promise<OcrSweepResult> {
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
  // G-09 sweep — multi-page documents (api/documents). Path-form scans
  // (`<restaurantId>/scan-….<ext>`, never an expiring URL) are signed HERE, so a
  // lost enqueue is retried; the dedupe key carries the page count, so an
  // invoice re-opened for a composed re-OCR is retried too.
  const pathSince = new Date(now.getTime() - G09_PATH_MAX_AGE_MS);
  const pathStale = await sql<
    Array<{ id: string; restaurant_id: string; supplier_id: string | null; raw_image_url: string; object: string }>
  >`
    SELECT i.id, i.restaurant_id, i.supplier_id, i.raw_image_url,
           -- the object id (scan-…): the OCR dedupe key is per (invoice, object)
           regexp_replace(split_part(i.raw_image_url, '/', 2), '\.[A-Za-z0-9]+$', '') AS object
      FROM invoices i
     WHERE i.status = 'ocr_pending'
       AND i.raw_image_url !~* '^[a-z][a-z0-9+.-]*:'
       AND split_part(i.raw_image_url, '/', 1) = i.restaurant_id::text
       AND i.updated_at < ${staleBefore}
       AND i.updated_at >= ${pathSince}
       AND NOT EXISTS (
         SELECT 1 FROM job_queue j
          WHERE j.queue = 'ocr-invoice' AND j.payload->>'invoiceId' = i.id::text
            AND j.dedupe_key IN (
              'ocr:' || i.id::text || ':' || regexp_replace(split_part(i.raw_image_url, '/', 2), '\.[A-Za-z0-9]+$', ''),
              'ocr-sweep-' || i.id::text || ':' || regexp_replace(split_part(i.raw_image_url, '/', 2), '\.[A-Za-z0-9]+$', ''))
            AND NOT (
              j.status = 'failed'
              AND j.dedupe_key NOT LIKE 'ocr-sweep-%'
              AND coalesce(j.last_error, '') ~ ${NOT_FOUND_REFUSAL_PG}
            )
       )
     ORDER BY i.updated_at
     LIMIT ${OCR_SWEEP_BATCH}`;
  for (const inv of pathStale) {
    const ref = toObjectRef(inv.raw_image_url, inv.restaurant_id);
    const imageUrl = ref ? await signObjectRef(inv.restaurant_id, ref) : null;
    if (!imageUrl) {
      // Not this tenant's object, or storage unavailable: never enqueue a foreign path.
      console.warn(`[ocr-sweep] G-09: could not sign the scan of invoice=${inv.id}; not re-enqueued`);
      continue;
    }
    const inserted = await insertJob(
      sql,
      'ocr-invoice',
      { restaurantId: inv.restaurant_id, invoiceId: inv.id, supplierId: inv.supplier_id, imageUrl },
      { restaurantId: inv.restaurant_id, dedupeKey: `ocr-sweep-${inv.id}:${inv.object}` },
    );
    (inserted ? result.requeued : result.raced).push(inv.id);
  }

  // Held pages: an ingested page, read ('matched'), never matched and with no
  // match job, waited G09_HOLD_MAX_MS for a sibling that never settled (a lost
  // job, a crash, or the switch turned OFF meanwhile — so this does NOT depend
  // on features.multiPage: switch-off is the rollback). Release it: a plain
  // match job is idempotent and the engine skips an invoice that already has a
  // run. Never a re-shot duplicate (it waits for a person), and not while a
  // sibling page of the same sender is merely slow (still ocr_pending).
  const holdBefore = new Date(now.getTime() - G09_HOLD_MAX_MS);
  const held = await sql<Array<{ id: string; restaurant_id: string }>>`
    SELECT i.id, i.restaurant_id
      FROM invoices i
     WHERE i.status = 'matched'
       AND coalesce(i.updated_at, i.created_at) < ${holdBefore}
       AND coalesce(i.updated_at, i.created_at) >= ${pathSince}
       AND EXISTS (SELECT 1 FROM ingest_documents d
                    WHERE d.invoice_id = i.id AND d.restaurant_id = i.restaurant_id AND d.status = 'registered')
       AND NOT EXISTS (SELECT 1 FROM ingest_documents d
                        WHERE d.invoice_id = i.id AND d.restaurant_id = i.restaurant_id AND d.error = 'page_duplicate')
       AND NOT EXISTS (
         SELECT 1
           FROM ingest_documents d
           JOIN ingest_messages m ON m.id = d.message_id AND m.restaurant_id = d.restaurant_id
           JOIN ingest_documents d2 ON d2.restaurant_id = d.restaurant_id AND d2.status = 'registered'
           JOIN ingest_messages m2 ON m2.id = d2.message_id AND m2.restaurant_id = d2.restaurant_id
           JOIN invoices i2 ON i2.id = d2.invoice_id AND i2.restaurant_id = d2.restaurant_id
          WHERE d.invoice_id = i.id AND d.restaurant_id = i.restaurant_id
            AND m2.channel_id = m.channel_id AND m2.sender = m.sender
            AND i2.id <> i.id AND i2.status = 'ocr_pending'
            AND m2.received_at BETWEEN m.received_at - interval '2 hours' AND m.received_at + interval '2 hours'
            AND coalesce(i2.updated_at, i2.created_at) >= ${pathSince})
       AND NOT EXISTS (SELECT 1 FROM match_runs m WHERE m.invoice_id = i.id AND m.restaurant_id = i.restaurant_id)
       AND NOT EXISTS (SELECT 1 FROM job_queue j
                        WHERE j.queue = 'match-invoice' AND j.payload->>'invoiceId' = i.id::text)
     ORDER BY i.created_at
     LIMIT ${OCR_SWEEP_BATCH}`;
  result.released = [];
  for (const inv of held) {
    const inserted = await insertJob(
      sql,
      'match-invoice',
      { restaurantId: inv.restaurant_id, invoiceId: inv.id },
      { restaurantId: inv.restaurant_id, dedupeKey: `g09-release-${inv.id}`, maxAttempts: 3 },
    );
    if (inserted) result.released.push(inv.id);
  }
  // end G-09 sweep

  return result;
}

export function startOcrSweepWorker() {
  return makeWorker<OcrSweepJob>('ocr-sweep', processOcrSweep);
}

/** The ocr-sweep job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processOcrSweep(job: WorkerJob<OcrSweepJob>) {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: 'ANTHROPIC_API_KEY unset — retries could only fail' };
  const result = await runOcrSweep(workerSql(), job.data.now ? new Date(job.data.now) : new Date());
  if (result.requeued.length) console.log(`[ocr-sweep] ${JSON.stringify(result)}`);
  return result;
}
