export interface MatchCandidate {
  productId: string;
  canonicalName: string;
  confidence: number;
  matchedBy: 'alias_exact' | 'embedding' | 'fuzzy' | 'barcode';
}

export interface CatalogMatchInput {
  restaurantId: string;
  supplierId: string | null;
  rawDescription: string;
  embedding?: number[];
  barcode?: string;
}

export async function matchCatalogItem(_input: CatalogMatchInput): Promise<MatchCandidate | null> {
  throw new Error(
    'matchCatalogItem not yet implemented — see plan section 4.3 (alias → embedding → fuzzy).',
  );
}
