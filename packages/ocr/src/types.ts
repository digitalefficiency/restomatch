import type { InvoiceOcrLine, InvoiceOcrResult, NormalizedPurchaseOrder } from '@restomatch/types';
import type { OcrChecks } from './checks';
import type { DocumentKind, InvoiceExtractionV2, LineKind } from './providers/invoiceSchema';

export type OcrProviderId = 'document_ai' | 'claude_vision';

export type ImageSource = Buffer | URL | string;

/**
 * Parses an uploaded order document (PDF/image) into a normalized purchase
 * order. Implemented by ClaudePoParser (real) and StubPoParser (tests/pilot).
 */
export interface PoDocumentParser {
  parse(image: ImageSource): Promise<NormalizedPurchaseOrder>;
}

export interface OcrProvider {
  readonly id: OcrProviderId;
  extract(image: ImageSource): Promise<InvoiceOcrResult>;
}

export interface OcrConflict {
  field: string;
  documentAi: unknown;
  claude: unknown;
  resolved: unknown;
  resolvedBy: OcrProviderId | 'agreement' | 'derived';
}

export interface ProductCandidate {
  productId: string;
  canonicalName: string;
  confidence: number;
  matchedBy: 'sku' | 'alias' | 'barcode' | 'embedding' | 'fuzzy';
}

export interface ResolvedInvoiceLine extends InvoiceOcrLine {
  /**
   * English rendering of rawDescription ("Receiver in English"). Produced by
   * ClaudeVision in the SAME extraction call (zero extra spend); absent for
   * providers that don't emit it. Display-only — matching uses rawDescription.
   */
  rawDescriptionEn?: string | null;
  /** v2: line discount in percent as printed (unitPrice is already net of it). */
  lineDiscountPct?: number;
  /** v2: 'deposit' (פיקדון) and 'delivery_fee' lines are not products. */
  lineKind?: LineKind;
  productId: string | null;
  productCandidates: ProductCandidate[];
}

export interface ResolvedInvoice extends Omit<InvoiceOcrResult, 'lines' | 'totals'> {
  lines: ResolvedInvoiceLine[];
  totals: InvoiceOcrResult['totals'] & { vatRate?: number };
  /** v2 (PR-OCR-2) document-level fields, carried from the Claude read. */
  documentKind?: DocumentKind;
  buyer?: InvoiceExtractionV2['buyer'];
  deliveryNotes?: InvoiceExtractionV2['deliveryNotes'];
  periodStart?: string;
  periodEnd?: string;
  invoiceDiscount?: number;
  continuesOnAnotherPage?: boolean;
  handwrittenCorrection?: boolean;
}

export interface OcrPipelineResult {
  primary: InvoiceOcrResult;
  reconciled: ResolvedInvoice;
  providers: {
    documentAi: InvoiceOcrResult;
    claude: InvoiceOcrResult;
  };
  confidence: number;
  needsHumanReview: boolean;
  conflicts: OcrConflict[];
  /** Arithmetic gate + ח״פ + document flags (./checks). Any reason ⇒ needsHumanReview. */
  checks: OcrChecks;
}

export type CatalogMatcherFn = (line: InvoiceOcrLine) => Promise<ProductCandidate[]>;

export interface OcrPipelineOptions {
  documentAi: OcrProvider;
  claude: OcrProvider;
  catalogMatcher?: CatalogMatcherFn;
  /** Confidence below which the pipeline flags the invoice for human review */
  reviewThreshold?: number;
  /** The supplier's ח״פ on file; a different printed one adds 'supplier_id_mismatch'. */
  expectedSupplierBusinessId?: string | null;
}

export const DEFAULT_REVIEW_THRESHOLD = 0.85;
/** A single line read below this (e.g. an unreadable qty zero-filled at 0.2) sends the invoice to human review. */
export const LINE_REVIEW_THRESHOLD = 0.5;
