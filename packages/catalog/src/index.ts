export * from './types';
export { MockEmbeddingProvider, cosineSimilarity } from './embeddings';
export {
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
