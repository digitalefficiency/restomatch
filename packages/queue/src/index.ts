import type { OcrInvoiceJob } from '@restomatch/types';
import { insertJob, queueDbUrl, queueSql, type EnqueueOptions } from './jobs';

/* ──────────────────────────────────────────────────────────────────────────
 * Producers enqueue into Postgres (0061 job_queue) — Redis/BullMQ are gone
 * (owner decision 2026-10-24). The exported functions and their signatures are
 * unchanged, so callers (receiving, catalog, the OCR worker) did not change.
 *
 * Enqueue still FAILS FAST (EN-7 / F7): the web app enqueues inside a request,
 * so a database that does not answer must surface as a coded
 * QueueUnavailableError within ENQUEUE_TIMEOUT_MS — never a request that hangs
 * until the serverless function times out.
 * ────────────────────────────────────────────────────────────────────────── */

export * from './jobs';

/** How long a producer waits for the queue database before giving up (ms). */
export const ENQUEUE_TIMEOUT_MS = 3_000;

/** Stable code the API/UI key off (never the message text). */
export const QUEUE_UNAVAILABLE = 'queue.unavailable' as const;

export class QueueUnavailableError extends Error {
  readonly code = QUEUE_UNAVAILABLE;
  constructor(
    readonly queue: string,
    reason: string,
  ) {
    super(`[queue] ${queue} unavailable: ${reason}`);
    this.name = 'QueueUnavailableError';
  }
}

export function isQueueUnavailableError(err: unknown): err is QueueUnavailableError {
  return (
    err instanceof QueueUnavailableError ||
    (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === QUEUE_UNAVAILABLE)
  );
}

/** Reject with `onTimeout()` if `p` has not settled within `ms`. */
export async function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Per-queue defaults: match-invoice is cheap and idempotent, so it retries. */
const MAX_ATTEMPTS: Record<string, number> = { 'match-invoice': 3 };

/**
 * Insert a job with a hard deadline. Returns false when no queue database is
 * configured (dev/test without DATABASE_URL); throws QueueUnavailableError on
 * any database error or timeout. (A timed-out INSERT may still commit later:
 * consumers must be idempotent, as they were under BullMQ.)
 */
export async function enqueue(
  queue: string,
  payload: unknown,
  opts: EnqueueOptions = {},
  timeoutMs = ENQUEUE_TIMEOUT_MS,
): Promise<boolean> {
  const url = queueDbUrl();
  if (!url) {
    console.warn(`[queue] no DATABASE_URL — skipping enqueue of ${queue}`);
    return false;
  }
  const restaurantId =
    opts.restaurantId !== undefined
      ? opts.restaurantId
      : (payload as { restaurantId?: unknown } | null)?.restaurantId;
  try {
    await withDeadline(
      insertJob(queueSql(url), queue, payload, {
        maxAttempts: MAX_ATTEMPTS[queue] ?? 1,
        ...opts,
        restaurantId: typeof restaurantId === 'string' ? restaurantId : null,
      }),
      timeoutMs,
      () => new QueueUnavailableError(queue, `no answer from the queue database within ${timeoutMs}ms`),
    );
    return true;
  } catch (err) {
    if (err instanceof QueueUnavailableError) throw err;
    throw new QueueUnavailableError(queue, err instanceof Error ? err.message : String(err));
  }
}

/** Queue name shared with the worker consumer (apps/worker/src/jobs/ocrInvoice.ts). */
export const OCR_INVOICE_QUEUE = 'ocr-invoice';

/**
 * Enqueue an 'ocr-invoice' job for the worker. Returns false (no-op) without a
 * queue database; throws QueueUnavailableError within ENQUEUE_TIMEOUT_MS when
 * the database is unreachable or rejects the insert.
 */
export async function enqueueOcrInvoice(payload: OcrInvoiceJob): Promise<boolean> {
  return enqueue(OCR_INVOICE_QUEUE, payload);
}

/* ──────────────────────────────────────────────────────────────────────────
 * match-invoice: the producer side of the 3-way match. Sends only identifiers;
 * the worker discovers the PO/GR and assembles the MatchInput server-side.
 * ────────────────────────────────────────────────────────────────────────── */

export const MATCH_INVOICE_QUEUE = 'match-invoice';

export interface MatchInvoiceQueueJob {
  restaurantId: string;
  invoiceId: string;
}

/** Enqueue a 'match-invoice' job (same contract as enqueueOcrInvoice). */
export async function enqueueMatchInvoice(payload: MatchInvoiceQueueJob): Promise<boolean> {
  return enqueue(MATCH_INVOICE_QUEUE, payload);
}

/* ──────────────────────────────────────────────────────────────────────────
 * import-catalog: background commit of a large supplier price-list import.
 * The file content travels in the payload so the worker re-parses + commits.
 * ────────────────────────────────────────────────────────────────────────── */

export const CATALOG_IMPORT_QUEUE = 'import-catalog';

export interface CatalogImportQueueJob {
  restaurantId: string;
  supplierId: string;
  importId: string;
  file: { filename: string; base64?: string; text?: string };
  mapping: Record<string, string | undefined>;
}

/** Enqueue an 'import-catalog' job (same contract as enqueueOcrInvoice). */
export async function enqueueCatalogImport(payload: CatalogImportQueueJob): Promise<boolean> {
  return enqueue(CATALOG_IMPORT_QUEUE, payload);
}

export type { OcrInvoiceJob };
