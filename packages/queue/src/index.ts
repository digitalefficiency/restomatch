import type { OcrInvoiceJob } from '@restomatch/types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/* ──────────────────────────────────────────────────────────────────────────
 * Producer connections FAIL FAST (EN-7 / F7). The web app enqueues inside a
 * request: with ioredis' default offline queue + maxRetriesPerRequest:null an
 * unreachable or malformed REDIS_URL made queue.add() wait forever, so the
 * serverless function timed out and the user never got an answer. Producers
 * now use no offline queue, a short connect timeout and a hard deadline on
 * add(). (Workers keep maxRetriesPerRequest:null — BullMQ requires it for
 * blocking consumers; that lives in apps/worker/src/queue.ts.)
 * ────────────────────────────────────────────────────────────────────────── */

/** How long a producer waits for Redis before giving up (ms). */
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

/**
 * Why a REDIS_URL cannot work, or null when it looks usable (or is unset). The
 * classic misconfiguration is pasting Upstash's REST URL (https://…) instead of
 * the Redis protocol URL (rediss://…): ioredis then dials port 6379 on the REST
 * host and hangs.
 */
export function redisUrlProblem(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'REDIS_URL is not a valid URL';
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    const hint = parsed.protocol.startsWith('http')
      ? ' — this looks like the Upstash REST URL; use the Redis (TLS) URL'
      : '';
    return `REDIS_URL must start with redis:// or rediss:// (got ${parsed.protocol}//…)${hint}`;
  }
  if (!parsed.hostname) return 'REDIS_URL has no host';
  return null;
}

/**
 * ioredis options for any client used INSIDE a web request (producers, rate
 * limiter, heartbeat reads): no offline queue, short connect timeout, capped
 * background reconnect. Pair every command with {@link withDeadline} — a socket
 * that connects but never answers is not covered by connectTimeout.
 */
export function failFastRedisOptions() {
  return {
    // Commands issued while disconnected reject immediately instead of queueing.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: ENQUEUE_TIMEOUT_MS,
    // Keep reconnecting in the background (capped back-off) so a later request
    // succeeds once Redis is back; requests themselves never wait on it.
    retryStrategy: (times: number) => Math.min(times * 200, 2_000),
  };
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

function producerConnection(url: string): IORedis {
  return new IORedis(url, failFastRedisOptions());
}

/**
 * Add a job with a hard deadline. Any connection problem (DNS, refused, auth,
 * TLS, timeout) surfaces as a QueueUnavailableError within `timeoutMs`.
 */
export async function addWithDeadline<T>(
  queue: { name: string; add: (name: string, data: T) => Promise<unknown> },
  jobName: string,
  payload: T,
  timeoutMs = ENQUEUE_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QueueUnavailableError(queue.name, `no answer from Redis within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([queue.add(jobName, payload), deadline]);
  } catch (err) {
    if (err instanceof QueueUnavailableError) throw err;
    throw new QueueUnavailableError(queue.name, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * BullMQ re-emits connection errors on the Queue; with no listener Node treats
 * an 'error' event as fatal and ioredis prints a stack per reconnect attempt.
 * Log one line per queue at most every 30 s instead.
 */
export function attachQuietErrorLog(queue: { name: string; on: (ev: 'error', fn: (err: Error) => void) => unknown }) {
  let lastAt = 0;
  queue.on('error', (err) => {
    const now = Date.now();
    if (now - lastAt < 30_000) return;
    lastAt = now;
    console.warn(`[queue] ${queue.name} redis error (producer keeps retrying in the background): ${err.message}`);
  });
}

function makeProducerQueue<T>(name: string, url: string): Queue<T> {
  const queue = new Queue<T>(name, { connection: producerConnection(url) });
  attachQuietErrorLog(queue as unknown as Parameters<typeof attachQuietErrorLog>[0]);
  return queue;
}

/** REDIS_URL for a producer: null when unset, throws when it cannot work. */
function producerUrl(queueName: string): string | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const problem = redisUrlProblem(url);
  if (problem) throw new QueueUnavailableError(queueName, problem);
  return url;
}

/** Queue name shared with the worker consumer (apps/worker/src/jobs/ocrInvoice.ts). */
export const OCR_INVOICE_QUEUE = 'ocr-invoice';

let ocrInvoiceQueue: Queue<OcrInvoiceJob> | null = null;

/**
 * Lazily construct the shared BullMQ Queue against REDIS_URL. Returns null when
 * REDIS_URL is unset so dev/test environments without Redis don't crash.
 */
function getOcrInvoiceQueue(): Queue<OcrInvoiceJob> | null {
  const url = producerUrl(OCR_INVOICE_QUEUE);
  if (!url) return null;
  if (!ocrInvoiceQueue) {
    ocrInvoiceQueue = makeProducerQueue<OcrInvoiceJob>(OCR_INVOICE_QUEUE, url);
  }
  return ocrInvoiceQueue;
}

/**
 * Enqueue an 'ocr-invoice' job for the worker to consume. Returns false (no-op,
 * console.warn) when REDIS_URL is unset, so callers in environments without
 * Redis degrade gracefully. Throws QueueUnavailableError within
 * ENQUEUE_TIMEOUT_MS when REDIS_URL is set but unusable or unreachable. (A
 * timed-out add may still land later: consumers must be idempotent.)
 */
export async function enqueueOcrInvoice(payload: OcrInvoiceJob): Promise<boolean> {
  const queue = getOcrInvoiceQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of ocr-invoice for invoice=${payload.invoiceId}`,
    );
    return false;
  }
  await addWithDeadline(queue, OCR_INVOICE_QUEUE, payload);
  return true;
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

let matchInvoiceQueue: Queue<MatchInvoiceQueueJob> | null = null;
function getMatchInvoiceQueue(): Queue<MatchInvoiceQueueJob> | null {
  const url = producerUrl(MATCH_INVOICE_QUEUE);
  if (!url) return null;
  if (!matchInvoiceQueue) {
    matchInvoiceQueue = makeProducerQueue<MatchInvoiceQueueJob>(MATCH_INVOICE_QUEUE, url);
  }
  return matchInvoiceQueue;
}

/**
 * Enqueue a 'match-invoice' job. Returns false (no-op) when REDIS_URL is unset;
 * throws QueueUnavailableError when it is set but unusable or unreachable.
 */
export async function enqueueMatchInvoice(payload: MatchInvoiceQueueJob): Promise<boolean> {
  const queue = getMatchInvoiceQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of match-invoice for invoice=${payload.invoiceId}`,
    );
    return false;
  }
  await addWithDeadline(queue, MATCH_INVOICE_QUEUE, payload);
  return true;
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

let catalogImportQueue: Queue<CatalogImportQueueJob> | null = null;
function getCatalogImportQueue(): Queue<CatalogImportQueueJob> | null {
  const url = producerUrl(CATALOG_IMPORT_QUEUE);
  if (!url) return null;
  if (!catalogImportQueue) {
    catalogImportQueue = makeProducerQueue<CatalogImportQueueJob>(CATALOG_IMPORT_QUEUE, url);
  }
  return catalogImportQueue;
}

/**
 * Enqueue an 'import-catalog' job. Returns false (no-op) when REDIS_URL is
 * unset; throws QueueUnavailableError when it is set but unusable/unreachable.
 */
export async function enqueueCatalogImport(payload: CatalogImportQueueJob): Promise<boolean> {
  const queue = getCatalogImportQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of import-catalog for import=${payload.importId}`,
    );
    return false;
  }
  await addWithDeadline(queue, CATALOG_IMPORT_QUEUE, payload);
  return true;
}

export type { OcrInvoiceJob };
