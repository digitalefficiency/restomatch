export * from './types';
export { MockEmbeddingProvider, cosineSimilarity } from './embeddings';
export {
  matchByAlias,
  matchByBarcode,
  matchByEmbedding,
  matchByFuzzy,
  matchProduct,
} from './matcher';
export {
  recordConfirmedMatch,
  type RecordConfirmedMatchParams,
  type RecordConfirmedMatchResult,
} from './learning';
