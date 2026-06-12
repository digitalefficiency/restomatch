import { and, eq, isNull, or, products, productAliases, sql, type Database } from '@restomatch/db';
import {
  DEFAULT_THRESHOLDS,
  type CatalogMatchInput,
  type MatchCandidate,
  type MatcherThresholds,
} from './types';

/**
 * pgvector literals are built by string interpolation; reject anything that is
 * not a plain finite number so no other token can ever reach the SQL string.
 */
function toVectorLiteral(embedding: number[]): string {
  if (!embedding.every(Number.isFinite)) {
    throw new Error('embedding contains non-finite values');
  }
  return `[${embedding.join(',')}]`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 1: alias exact lookup
 *
 * Restaurant-scoped (through products), then (supplier_id, supplier_name_raw)
 * — case insensitive. Confidence = 1.0 for exact matches.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByAlias(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  rawName: string,
): Promise<MatchCandidate | null> {
  const normalized = rawName.trim().toLowerCase();
  if (!normalized) return null;

  const supplierFilter = supplierId
    ? eq(productAliases.supplierId, supplierId)
    : isNull(productAliases.supplierId);

  // product_aliases has no restaurant_id — tenant scope goes through products,
  // otherwise a null-supplier alias from another restaurant can match at 1.0.
  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      aliasId: productAliases.id,
      supplierNameRaw: productAliases.supplierNameRaw,
    })
    .from(productAliases)
    .innerJoin(
      products,
      and(eq(products.id, productAliases.productId), eq(products.restaurantId, restaurantId)),
    )
    .where(and(supplierFilter, sql`lower(${productAliases.supplierNameRaw}) = ${normalized}`))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    productId: row.productId,
    canonicalName: row.canonicalName,
    confidence: 1.0,
    matchedBy: 'alias',
    aliasId: row.aliasId,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 2: barcode exact lookup
 *
 * Restaurant-scoped. Confidence = 1.0.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByBarcode(
  db: Database,
  restaurantId: string,
  barcode: string,
): Promise<MatchCandidate | null> {
  const normalized = barcode.trim();
  if (!normalized) return null;

  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
    })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), eq(products.barcodeEan, normalized)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    productId: row.productId,
    canonicalName: row.canonicalName,
    confidence: 1.0,
    matchedBy: 'barcode',
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 3: pgvector embedding similarity (cosine)
 *
 * Returns the closest product if similarity ≥ threshold.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByEmbedding(
  db: Database,
  restaurantId: string,
  embedding: number[],
  threshold = DEFAULT_THRESHOLDS.embeddingMinSimilarity,
): Promise<MatchCandidate | null> {
  if (embedding.length === 0) return null;

  // pgvector cosine distance = 1 - cosine similarity
  // Use <=> operator (cosine distance) and convert
  const vectorLiteral = toVectorLiteral(embedding);

  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      similarity: sql<number>`1 - (${products.embedding} <=> ${vectorLiteral}::vector)`.as(
        'similarity',
      ),
    })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), sql`${products.embedding} IS NOT NULL`))
    .orderBy(sql`${products.embedding} <=> ${vectorLiteral}::vector`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const similarity = Number(row.similarity);
  if (similarity < threshold) return null;
  return {
    productId: row.productId,
    canonicalName: row.canonicalName,
    confidence: similarity,
    matchedBy: 'embedding',
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 4: pg_trgm fuzzy match
 *
 * Uses similarity() against canonical_name. Restaurant-scoped.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByFuzzy(
  db: Database,
  restaurantId: string,
  rawName: string,
  threshold = DEFAULT_THRESHOLDS.fuzzyMinSimilarity,
): Promise<MatchCandidate | null> {
  const normalized = rawName.trim();
  if (!normalized) return null;

  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      similarity: sql<number>`similarity(${products.canonicalName}, ${normalized})`.as(
        'similarity',
      ),
    })
    .from(products)
    .where(
      and(
        eq(products.restaurantId, restaurantId),
        sql`similarity(${products.canonicalName}, ${normalized}) >= ${threshold}`,
      ),
    )
    .orderBy(sql`similarity(${products.canonicalName}, ${normalized}) DESC`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    productId: row.productId,
    canonicalName: row.canonicalName,
    confidence: Number(row.similarity),
    matchedBy: 'fuzzy',
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Composite: try strategies in order
 *
 * alias → barcode → embedding → fuzzy
 * Returns first successful match.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchProduct(
  db: Database,
  input: CatalogMatchInput,
  thresholds: MatcherThresholds = DEFAULT_THRESHOLDS,
): Promise<MatchCandidate | null> {
  // 1. Alias
  const aliasMatch = await matchByAlias(
    db,
    input.restaurantId,
    input.supplierId ?? null,
    input.rawDescription,
  );
  if (aliasMatch) return aliasMatch;

  // 2. Barcode
  if (input.barcode) {
    const barcodeMatch = await matchByBarcode(db, input.restaurantId, input.barcode);
    if (barcodeMatch) return barcodeMatch;
  }

  // 3. Embedding
  if (input.embedding) {
    const embeddingMatch = await matchByEmbedding(
      db,
      input.restaurantId,
      input.embedding,
      thresholds.embeddingMinSimilarity,
    );
    if (embeddingMatch) return embeddingMatch;
  }

  // 4. Fuzzy
  const fuzzyMatch = await matchByFuzzy(
    db,
    input.restaurantId,
    input.rawDescription,
    thresholds.fuzzyMinSimilarity,
  );
  if (fuzzyMatch) return fuzzyMatch;

  return null;
}

/**
 * Top-N variant: returns up to `limit` candidates from embedding + fuzzy
 * strategies, useful when OCR confidence is low and human review will pick
 * the right product from suggestions.
 *
 * Alias and barcode are exact-match so we never need top-N for them — if
 * one of those matches, it short-circuits at confidence 1.
 */
export async function matchProductTopN(
  db: Database,
  input: CatalogMatchInput,
  limit = 3,
  thresholds: MatcherThresholds = DEFAULT_THRESHOLDS,
): Promise<MatchCandidate[]> {
  // Exact matches short-circuit (these are always rank-1)
  const aliasMatch = await matchByAlias(
    db,
    input.restaurantId,
    input.supplierId ?? null,
    input.rawDescription,
  );
  if (aliasMatch) return [aliasMatch];

  if (input.barcode) {
    const barcodeMatch = await matchByBarcode(db, input.restaurantId, input.barcode);
    if (barcodeMatch) return [barcodeMatch];
  }

  const candidates: MatchCandidate[] = [];

  if (input.embedding) {
    const embeddingCandidates = await topNByEmbedding(
      db,
      input.restaurantId,
      input.embedding,
      limit,
      thresholds.embeddingMinSimilarity,
    );
    candidates.push(...embeddingCandidates);
  }

  const fuzzyCandidates = await topNByFuzzy(
    db,
    input.restaurantId,
    input.rawDescription,
    limit,
    thresholds.fuzzyMinSimilarity,
  );
  for (const f of fuzzyCandidates) {
    if (!candidates.some((c) => c.productId === f.productId)) candidates.push(f);
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

async function topNByEmbedding(
  db: Database,
  restaurantId: string,
  embedding: number[],
  limit: number,
  threshold: number,
): Promise<MatchCandidate[]> {
  if (embedding.length === 0) return [];
  const vectorLiteral = toVectorLiteral(embedding);
  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      similarity: sql<number>`1 - (${products.embedding} <=> ${vectorLiteral}::vector)`.as(
        'similarity',
      ),
    })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), sql`${products.embedding} IS NOT NULL`))
    .orderBy(sql`${products.embedding} <=> ${vectorLiteral}::vector`)
    .limit(limit);

  return rows
    .map<MatchCandidate>((row) => ({
      productId: row.productId,
      canonicalName: row.canonicalName,
      confidence: Number(row.similarity),
      matchedBy: 'embedding',
    }))
    .filter((c) => c.confidence >= threshold);
}

async function topNByFuzzy(
  db: Database,
  restaurantId: string,
  rawName: string,
  limit: number,
  threshold: number,
): Promise<MatchCandidate[]> {
  const normalized = rawName.trim();
  if (!normalized) return [];
  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      similarity: sql<number>`similarity(${products.canonicalName}, ${normalized})`.as(
        'similarity',
      ),
    })
    .from(products)
    .where(
      and(
        eq(products.restaurantId, restaurantId),
        sql`similarity(${products.canonicalName}, ${normalized}) >= ${threshold}`,
      ),
    )
    .orderBy(sql`similarity(${products.canonicalName}, ${normalized}) DESC`)
    .limit(limit);

  return rows.map<MatchCandidate>((row) => ({
    productId: row.productId,
    canonicalName: row.canonicalName,
    confidence: Number(row.similarity),
    matchedBy: 'fuzzy',
  }));
}

export { or };
