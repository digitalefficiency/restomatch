/**
 * G-09 · multi-page documents — the PUBLIC contract (day-1, stable).
 *
 * Consumers: W2-05 (`scans.composeDocument`, dock capture) and W2-02 (inbox
 * attach / split procedures). Code against these types only.
 */

/** Every named refusal a document service can return (never a bare 500). */
export type DocumentFailureReason =
  /** A page is not JPEG/PNG by magic bytes (webp included: clients normalise to JPEG). */
  | 'unsupported_page_type'
  /** The composed PDF would exceed `INGEST_LIMITS.attachmentBytes` (10 MB). */
  | 'too_large'
  /** More than `MAX_DOCUMENT_PAGES` pages. */
  | 'too_many_pages'
  /** An empty page list. */
  | 'no_pages'
  /** attach/split: the invoice has a decided פער (a human decision). */
  | 'decided'
  /** attach/split: the invoice has a credit claim. */
  | 'has_claim'
  /** attach/split: the invoice is approved or paid. */
  | 'approved_or_paid'
  /** attach: both ids are the same invoice. */
  | 'same_invoice'
  /** split: the page groups are not a partition of the document's pages. */
  | 'invalid_split'
  /** attach/split/cross-message grouping need the agreed `reocr` edge (G-05/G-06), not enabled yet. */
  | 'reocr_not_enabled';

export interface ComposeDocumentInput {
  restaurantId: string;
  /** Client-minted document id (W2-05: `clientDocumentId`). Same id → same object. */
  clientDocumentId: string;
  /** Tenant storage paths `<restaurantId>/<scanId>.<ext>`, in page order. Never bytes. */
  pageObjects: string[];
  /**
   * Delete the per-page objects after a successful write (best effort).
   * Default true (dock capture pages are transient). Ingest passes false: its
   * pages are the attachment records the inbox shows.
   */
  deletePages?: boolean;
}

export interface ComposedDocument {
  /** `<restaurantId>/<deterministicScanId(restaurantId, clientDocumentId)>.pdf` */
  storagePath: string;
  pageCount: number;
  /** sha256 (hex) of the composed PDF bytes. */
  sha256: string;
  /** false when the object already existed (idempotent replay; pages not re-read). */
  created: boolean;
}

export interface AttachAsPageInput {
  restaurantId: string;
  /** The invoice that survives and gains the page(s). */
  invoiceId: string;
  /** The already-split second invoice that is absorbed ("צרפו כעמוד 2 לחשבונית X"). */
  documentId: string;
  /** 0-based position of the absorbed pages in the result; default = append. */
  pageIndex?: number;
}

export interface AttachAsPageResult {
  invoiceId: string;
  absorbedInvoiceId: string;
  storagePath: string;
  pageCount: number;
  /** true when an OCR job was enqueued (exactly once per resulting page count). */
  ocrEnqueued: boolean;
}

export interface SplitDocumentInput {
  restaurantId: string;
  invoiceId: string;
  /** A partition of 0-based page indexes, e.g. [[0],[1,2]] → 2 invoices. */
  pages: number[][];
}

export interface SplitDocumentResult {
  /** The first entry is the original invoice (it keeps pages[0]). */
  invoiceIds: string[];
}
