import type { InvoiceOcrLine, InvoiceOcrResult, NormalizedPurchaseOrder } from '@restomatch/types';

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
  productId: string | null;
  productCandidates: ProductCandidate[];
}

export interface ResolvedInvoice extends Omit<InvoiceOcrResult, 'lines'> {
  lines: ResolvedInvoiceLine[];
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
}

export type CatalogMatcherFn = (line: InvoiceOcrLine) => Promise<ProductCandidate[]>;

export interface OcrPipelineOptions {
  documentAi: OcrProvider;
  claude: OcrProvider;
  catalogMatcher?: CatalogMatcherFn;
  /** Confidence below which the pipeline flags the invoice for human review */
  reviewThreshold?: number;
}

export const DEFAULT_REVIEW_THRESHOLD = 0.85;
