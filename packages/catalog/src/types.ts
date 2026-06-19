export type MatchStrategy = 'sku' | 'alias' | 'barcode' | 'embedding' | 'fuzzy';

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
  /**
   * Supplier catalog number (מק״ט). When present it is the highest-priority
   * key: an exact (supplierId, supplierSku) hit resolves at confidence 1.0
   * before any name-based strategy runs. Always scoped by supplierId — SKU
   * namespaces collide across suppliers.
   */
  supplierSku?: string | null;
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
