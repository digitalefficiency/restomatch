export * from './types';
export { StubOcrProvider, FixtureRoutingOcrProvider } from './providers/stub';
export { GoogleDocumentAi, type GoogleDocumentAiConfig } from './providers/documentAi';
export {
  ClaudeVision,
  DEFAULT_OCR_MODEL,
  DEFAULT_OCR_EFFORT,
  DEFAULT_OCR_TIMEOUT_MS,
  OCR_MAX_RETRIES,
  ocrTimeoutMs,
  type ClaudeVisionConfig,
  type ClaudeInvoiceExtraction,
  type ExtractionMeta,
  type OcrEffort,
} from './providers/claudeVision';
export {
  InvoiceExtractionV2,
  InvoiceLineV2,
  DOCUMENT_KINDS,
  LINE_KINDS,
  type DocumentKind,
  type LineKind,
} from './providers/invoiceSchema';
export { OcrExtractionError, isOcrExtractionError, type OcrFailureCode, type OcrUsage } from './errors';
export {
  checkInvoice,
  isValidIsraeliBusinessId,
  lineProductAgorot,
  toAgorot,
  REVIEW_SCORE,
  type CheckableInvoice,
  type OcrCheckIssue,
  type OcrCheckReason,
  type OcrChecks,
} from './checks';
export {
  ClaudePoParser,
  StubPoParser,
  mapExtractionToNormalized,
  type ClaudePoParserConfig,
  type PoExtraction,
  type PlatformId,
} from './providers/claudePoVision';
export { reconcile, type ReconcileResult } from './reconciler';
export { runOcrPipeline } from './pipeline';
export {
  ClaudeOrderTextParser,
  StubOrderTextParser,
  OrderTextExtraction,
  OrderTextLine,
  ORDER_TEXT_MAX_CHARS,
  ORDER_TEXT_MAX_LINES,
  canonicalUnit,
  orderTextParserFromEnv,
  parseOrderLine,
  parseOrderTextDeterministic,
  type ClaudeOrderTextParserConfig,
  type OrderTextParser,
} from './providers/orderText';
