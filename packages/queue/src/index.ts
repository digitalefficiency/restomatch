import type { OcrInvoiceJob } from '@restomatch/types';
import { insertJob, queueDbUrl, queueSql, type EnqueueOptions } from './jobs';
import { notifyEnqueued } from './kick';

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
export * from './kick';

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

/**
 * Per-queue defaults: match-invoice is cheap and idempotent, so it retries.
 * ocr-invoice gets ONE retry: each attempt is a paid Claude read, so only a
 * transient failure (429, 5xx, timeout, unparsable answer) is retried; a
 * terminal one is dead-lettered at once (TERMINAL_JOB_ERROR, apps/worker
 * ocrInvoice.ts classifyOcrError).
 */
export const MAX_ATTEMPTS: Readonly<Record<string, number>> = { 'match-invoice': 3, 'ocr-invoice': 2 };

/** Default for OCR_JOB_HEADROOM_MS: a Claude read takes ≈ 10–40 s, its retry path more. */
export const OCR_JOB_HEADROOM_DEFAULT_MS = 120_000;

/**
 * The time an ocr-invoice job must have left in its invocation before it is
 * claimed (OCR_JOB_HEADROOM_MS, ms; default 120 s). A read cut off by the
 * function's maxDuration stalls, is retried, and can be dead-lettered — after
 * being paid for. Used by the serverless runner and the after() kick.
 */
export function ocrJobHeadroomMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OCR_JOB_HEADROOM_MS?.trim();
  if (!raw) return OCR_JOB_HEADROOM_DEFAULT_MS;
  const n = Number(raw);
  if (!(Number.isFinite(n) && n >= 0)) return OCR_JOB_HEADROOM_DEFAULT_MS;
  // Clamped below the cron route's claim window (240 s, apps/web/lib/cronJobs.ts)
  // minus a margin: a headroom at or above it would never claim an OCR job at all.
  if (n > OCR_JOB_HEADROOM_MAX_MS) {
    if (!warnedHeadroom) {
      warnedHeadroom = true;
      console.warn(`[queue] OCR_JOB_HEADROOM_MS=${Math.floor(n)} is above ${OCR_JOB_HEADROOM_MAX_MS} — clamped`);
    }
    return OCR_JOB_HEADROOM_MAX_MS;
  }
  // …and clamped up to a floor: below ~60 s the job deadline (headroom − the
  // persistence margin) is shorter than a typical read, so every read would time
  // out, be retried, time out again — paid twice for nothing.
  if (n < OCR_JOB_HEADROOM_MIN_MS) {
    if (!warnedHeadroomLow) {
      warnedHeadroomLow = true;
      console.warn(`[queue] OCR_JOB_HEADROOM_MS=${Math.floor(n)} is below ${OCR_JOB_HEADROOM_MIN_MS} — clamped`);
    }
    return OCR_JOB_HEADROOM_MIN_MS;
  }
  return Math.floor(n);
}

/** The largest OCR_JOB_HEADROOM_MS honoured: the cron claim window (240 s) minus a 40 s margin. */
export const OCR_JOB_HEADROOM_MAX_MS = 200_000;
/** The smallest OCR_JOB_HEADROOM_MS honoured: a 40 s job deadline (60 s − the 20 s persistence margin). */
export const OCR_JOB_HEADROOM_MIN_MS = 60_000;
let warnedHeadroom = false;
let warnedHeadroomLow = false;

/** Time kept for persisting a read (header + lines + match enqueue) after the provider returns. */
export const OCR_PERSIST_MARGIN_MS = 20_000;

/**
 * The provider deadline of one OCR job: the headroom it was claimed with, minus
 * the persistence margin. A job is claimed only with this headroom left, so a
 * read that hits the deadline still leaves time to record a retryable failure —
 * never a function cut off mid-read (stall → paid twice).
 */
export function ocrJobDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  // ≥ 40 s: the headroom is clamped to at least OCR_JOB_HEADROOM_MIN_MS.
  return ocrJobHeadroomMs(env) - OCR_PERSIST_MARGIN_MS;
}

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
  } catch (err) {
    if (err instanceof QueueUnavailableError) throw err;
    throw new QueueUnavailableError(queue, err instanceof Error ? err.message : String(err));
  }
  // Serverless mode: let an in-process runner pick it up now (kick.ts). Never throws.
  notifyEnqueued(queue);
  return true;
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
  /** Replace an earlier run (receiving.submitReceipt: the count is now in). */
  rematch?: boolean;
  /** The PO of the receipt the invoice was scanned on — matched against it, not a discovered one. */
  poId?: string;
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
