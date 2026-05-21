export type MatchStrategy = 'alias' | 'barcode' | 'embedding' | 'fuzzy';

export interface MatchCandidate {
  productId: string;
  canonicalName: string;
  confidence: number;
  matchedBy: MatchStrategy;
  aliasId?: string | null;
}

export interface CatalogMatchInput {
  restaurantId: string;
  supplierId?: string | null;
  rawDescription: string;
  /** Pre-computed embedding (caller is responsible for invoking the provider) */
  embedding?: number[];
  barcode?: string;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

export interface MatcherThresholds {
  embeddingMinSimilarity: number;
  fuzzyMinSimilarity: number;
}

export const DEFAULT_THRESHOLDS: MatcherThresholds = {
  embeddingMinSimilarity: 0.85,
  fuzzyMinSimilarity: 0.5,
};
