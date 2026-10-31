export * from './types';
export { MockEmbeddingProvider, cosineSimilarity } from './embeddings';
export {
  matchBySku,
  matchByAlias,
  matchByBarcode,
  matchByEmbedding,
  matchByFuzzy,
  matchProduct,
  matchProductTopN,
} from './matcher';
export {
  recordConfirmedMatch,
  type RecordConfirmedMatchParams,
  type RecordConfirmedMatchResult,
} from './learning';
export {
  AUTO_LINK_MIN,
  REVIEW_FLOOR,
  HUMAN_CONFIDENCE,
  MACHINE_MAX_CONFIDENCE,
  GUESS_MAX_CONFIDENCE,
  MAX_SUGGESTIONS,
  decideLink,
  isExactKey,
  rankSuggestions,
  aliasProvenance,
  provenanceConfidence,
  type LinkProvenance,
  type ConfirmedProvenance,
  type LinkMatchedBy,
  type LinkCandidate,
  type ReviewReason,
  type UnitPackFit,
  type LinkRow,
  type LinkDecisionKind,
  type LinkDecision,
} from './linkPolicy';
