export * from './types';
export { StubOcrProvider, FixtureRoutingOcrProvider } from './providers/stub';
export { GoogleDocumentAi, type GoogleDocumentAiConfig } from './providers/documentAi';
export { ClaudeVision, type ClaudeVisionConfig } from './providers/claudeVision';
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
