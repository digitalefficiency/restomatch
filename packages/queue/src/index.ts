import type { OcrInvoiceJob } from '@restomatch/types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/** Queue name shared with the worker consumer (apps/worker/src/jobs/ocrInvoice.ts). */
export const OCR_INVOICE_QUEUE = 'ocr-invoice';

let ocrInvoiceQueue: Queue<OcrInvoiceJob> | null = null;

/**
 * Lazily construct the shared BullMQ Queue against REDIS_URL. Returns null when
 * REDIS_URL is unset so dev/test environments without Redis don't crash.
 */
function getOcrInvoiceQueue(): Queue<OcrInvoiceJob> | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!ocrInvoiceQueue) {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    ocrInvoiceQueue = new Queue<OcrInvoiceJob>(OCR_INVOICE_QUEUE, { connection });
  }
  return ocrInvoiceQueue;
}

/**
 * Enqueue an 'ocr-invoice' job for the worker to consume. No-ops (with a
 * console.warn) when REDIS_URL is unset, so callers in environments without
 * Redis degrade gracefully instead of throwing.
 */
export async function enqueueOcrInvoice(payload: OcrInvoiceJob): Promise<void> {
  const queue = getOcrInvoiceQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of ocr-invoice for invoice=${payload.invoiceId}`,
    );
    return;
  }
  await queue.add(OCR_INVOICE_QUEUE, payload);
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
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!matchInvoiceQueue) {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    matchInvoiceQueue = new Queue<MatchInvoiceQueueJob>(MATCH_INVOICE_QUEUE, { connection });
  }
  return matchInvoiceQueue;
}

/** Enqueue a 'match-invoice' job. Returns false (no-op) when REDIS_URL is unset. */
export async function enqueueMatchInvoice(payload: MatchInvoiceQueueJob): Promise<boolean> {
  const queue = getMatchInvoiceQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of match-invoice for invoice=${payload.invoiceId}`,
    );
    return false;
  }
  await queue.add(MATCH_INVOICE_QUEUE, payload);
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
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!catalogImportQueue) {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    catalogImportQueue = new Queue<CatalogImportQueueJob>(CATALOG_IMPORT_QUEUE, { connection });
  }
  return catalogImportQueue;
}

/** Enqueue an 'import-catalog' job. Returns false (no-op) when REDIS_URL is unset. */
export async function enqueueCatalogImport(payload: CatalogImportQueueJob): Promise<boolean> {
  const queue = getCatalogImportQueue();
  if (!queue) {
    console.warn(
      `[queue] REDIS_URL unset — skipping enqueue of import-catalog for import=${payload.importId}`,
    );
    return false;
  }
  await queue.add(CATALOG_IMPORT_QUEUE, payload);
  return true;
}

export type { OcrInvoiceJob };
