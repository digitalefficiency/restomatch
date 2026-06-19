import {
  and,
  eq,
  isNull,
  or,
  products,
  productAliases,
  sql,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
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
 * Supplier-scope predicate (the false-leak guard)
 *
 * A product is a candidate for supplier S only if S already sells it — i.e.
 * there is EITHER a product_aliases row with supplier_id = S, OR a (linked)
 * supplier_catalog_items row with supplier_id = S pointing at the product.
 * This decouples exclusivity from the not-yet-existent products.supplier_id
 * column: it uses the EXISTING supplier→product links so an invoice/import
 * from supplier A can never fuzzy/embed/barcode-match supplier B's product
 * and raise a phantom price-leak.
 *
 * Returns a correlated EXISTS predicate over `products.id` to be AND-ed into a
 * WHERE clause (used by barcode + fuzzy, whose predicate rides inside WHERE).
 * The embedding ANN over-fetches then filters in app code via the candidate
 * set below, because an EXISTS in WHERE would defeat the ivfflat index plan.
 *
 * supplierId must be present: a null/unknown supplier cannot be scoped, so the
 * caller (commit.ts) routes those to review/create-new rather than auto-link.
 * ────────────────────────────────────────────────────────────────────────── */

function supplierScopeSql(supplierId: string) {
  return sql`(
    EXISTS (
      SELECT 1 FROM ${productAliases}
      WHERE ${productAliases.productId} = ${products.id}
        AND ${productAliases.supplierId} = ${supplierId}
    )
    OR EXISTS (
      SELECT 1 FROM ${supplierCatalogItems}
      WHERE ${supplierCatalogItems.productId} = ${products.id}
        AND ${supplierCatalogItems.supplierId} = ${supplierId}
    )
  )`;
}

/**
 * The product ids supplier S already sells — its alias links UNION its linked
 * catalog items. Used to filter the over-fetched embedding ANN in app code
 * (the supplier predicate cannot ride inside the ivfflat ORDER BY without
 * dropping valid rows). Returns a Set for O(1) membership.
 */
async function supplierProductIds(
  db: Database,
  restaurantId: string,
  supplierId: string,
): Promise<Set<string>> {
  const [aliasRows, catalogRows] = await Promise.all([
    db
      .select({ productId: productAliases.productId })
      .from(productAliases)
      .innerJoin(
        products,
        and(eq(products.id, productAliases.productId), eq(products.restaurantId, restaurantId)),
      )
      .where(eq(productAliases.supplierId, supplierId)),
    db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(
        and(
          eq(supplierCatalogItems.restaurantId, restaurantId),
          eq(supplierCatalogItems.supplierId, supplierId),
        ),
      ),
  ]);

  const ids = new Set<string>();
  for (const r of aliasRows) ids.add(r.productId);
  for (const r of catalogRows) if (r.productId) ids.add(r.productId);
  return ids;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 0: supplier SKU exact lookup (מק״ט)
 *
 * The stable per-supplier key — preferred over fuzzy Hebrew names. Source of
 * truth is product_aliases (where recordConfirmedMatch persists supplier_sku);
 * falls back to supplier_catalog_items, whose priced price-list may already
 * carry a SKU→product link before any alias exists.
 *
 * Tenant scope: product_aliases has no restaurant_id, so it is scoped through
 * the products join (matching matchByAlias). supplier_catalog_items is scoped
 * by its own restaurant_id AND the products join for defence in depth.
 *
 * Requires supplierId: SKU namespaces collide across suppliers (100003 means
 * different goods per supplier), so a SKU is meaningless without it.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchBySku(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  supplierSku: string,
): Promise<MatchCandidate | null> {
  if (!supplierId) return null;
  const normalized = supplierSku.trim();
  if (!normalized) return null;

  // 1. product_aliases (source of truth) — tenant scope via products join.
  const aliasRows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
      aliasId: productAliases.id,
    })
    .from(productAliases)
    .innerJoin(
      products,
      and(eq(products.id, productAliases.productId), eq(products.restaurantId, restaurantId)),
    )
    .where(
      and(eq(productAliases.supplierId, supplierId), eq(productAliases.supplierSku, normalized)),
    )
    .limit(1);

  const aliasRow = aliasRows[0];
  if (aliasRow) {
    return {
      productId: aliasRow.productId,
      canonicalName: aliasRow.canonicalName,
      confidence: 1.0,
      matchedBy: 'sku',
      aliasId: aliasRow.aliasId,
    };
  }

  // 2. supplier_catalog_items (priced price-list). The inner join drops rows
  // whose product_id is still null (unlinked), so only resolved SKUs return.
  const catalogRows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
    })
    .from(supplierCatalogItems)
    .innerJoin(products, eq(products.id, supplierCatalogItems.productId))
    .where(
      and(
        eq(supplierCatalogItems.restaurantId, restaurantId),
        eq(supplierCatalogItems.supplierId, supplierId),
        eq(supplierCatalogItems.supplierSku, normalized),
        eq(products.restaurantId, restaurantId),
      ),
    )
    .limit(1);

  const catalogRow = catalogRows[0];
  if (!catalogRow) return null;
  return {
    productId: catalogRow.productId,
    canonicalName: catalogRow.canonicalName,
    confidence: 1.0,
    matchedBy: 'sku',
  };
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
 * Restaurant-scoped AND supplier-scoped (the false-leak guard): a barcode only
 * resolves to a product the queried supplier already sells. Without a supplier
 * a barcode is unscoped, so we refuse to match (caller routes to review).
 * Confidence = 1.0.
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByBarcode(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  barcode: string,
): Promise<MatchCandidate | null> {
  if (!supplierId) return null;
  const normalized = barcode.trim();
  if (!normalized) return null;

  const rows = await db
    .select({
      productId: products.id,
      canonicalName: products.canonicalName,
    })
    .from(products)
    .where(
      and(
        eq(products.restaurantId, restaurantId),
        eq(products.barcodeEan, normalized),
        supplierScopeSql(supplierId),
      ),
    )
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
 * Returns the closest product the supplier already sells, if similarity ≥
 * threshold. The supplier predicate canNOT ride inside the ivfflat ORDER BY
 * (an unindexed filter there would drop valid in-scope rows that fall outside
 * the probed lists), so we over-fetch the ANN then filter by supplier in app
 * code. Without a supplier we refuse to match (caller routes to review).
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByEmbedding(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  embedding: number[],
  threshold = DEFAULT_THRESHOLDS.embeddingMinSimilarity,
): Promise<MatchCandidate | null> {
  if (!supplierId) return null;
  const candidates = await topNByEmbedding(db, restaurantId, supplierId, embedding, 1, threshold);
  return candidates[0] ?? null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Strategy 4: pg_trgm fuzzy match
 *
 * Uses similarity() against canonical_name. Restaurant-scoped AND
 * supplier-scoped (the false-leak guard): only products the supplier already
 * sells are candidates. Without a supplier we refuse to match (caller routes
 * to review).
 * ────────────────────────────────────────────────────────────────────────── */

export async function matchByFuzzy(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  rawName: string,
  threshold = DEFAULT_THRESHOLDS.fuzzyMinSimilarity,
): Promise<MatchCandidate | null> {
  if (!supplierId) return null;
  const candidates = await topNByFuzzy(db, restaurantId, supplierId, rawName, 1, threshold);
  return candidates[0] ?? null;
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
  // 0. Supplier SKU (highest-priority exact key)
  if (input.supplierSku) {
    const skuMatch = await matchBySku(
      db,
      input.restaurantId,
      input.supplierId ?? null,
      input.supplierSku,
    );
    if (skuMatch) return skuMatch;
  }

  // 1. Alias
  const aliasMatch = await matchByAlias(
    db,
    input.restaurantId,
    input.supplierId ?? null,
    input.rawDescription,
  );
  if (aliasMatch) return aliasMatch;

  // 2. Barcode (supplier-scoped)
  if (input.barcode) {
    const barcodeMatch = await matchByBarcode(
      db,
      input.restaurantId,
      input.supplierId ?? null,
      input.barcode,
    );
    if (barcodeMatch) return barcodeMatch;
  }

  // 3. Embedding (supplier-scoped)
  if (input.embedding) {
    const embeddingMatch = await matchByEmbedding(
      db,
      input.restaurantId,
      input.supplierId ?? null,
      input.embedding,
      thresholds.embeddingMinSimilarity,
    );
    if (embeddingMatch) return embeddingMatch;
  }

  // 4. Fuzzy (supplier-scoped)
  const fuzzyMatch = await matchByFuzzy(
    db,
    input.restaurantId,
    input.supplierId ?? null,
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
  if (input.supplierSku) {
    const skuMatch = await matchBySku(
      db,
      input.restaurantId,
      input.supplierId ?? null,
      input.supplierSku,
    );
    if (skuMatch) return [skuMatch];
  }

  const aliasMatch = await matchByAlias(
    db,
    input.restaurantId,
    input.supplierId ?? null,
    input.rawDescription,
  );
  if (aliasMatch) return [aliasMatch];

  if (input.barcode) {
    const barcodeMatch = await matchByBarcode(
      db,
      input.restaurantId,
      input.supplierId ?? null,
      input.barcode,
    );
    if (barcodeMatch) return [barcodeMatch];
  }

  // From here only same-supplier fuzzy/embedding candidates are eligible. A
  // null/unknown supplier cannot be scoped, so we return no candidates (the
  // false-leak guard) — commit.ts then routes the row to review / create-new.
  const supplierId = input.supplierId ?? null;
  if (!supplierId) return [];

  const candidates: MatchCandidate[] = [];

  if (input.embedding) {
    const embeddingCandidates = await topNByEmbedding(
      db,
      input.restaurantId,
      supplierId,
      input.embedding,
      limit,
      thresholds.embeddingMinSimilarity,
    );
    candidates.push(...embeddingCandidates);
  }

  const fuzzyCandidates = await topNByFuzzy(
    db,
    input.restaurantId,
    supplierId,
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
  supplierId: string,
  embedding: number[],
  limit: number,
  threshold: number,
): Promise<MatchCandidate[]> {
  if (embedding.length === 0) return [];
  const vectorLiteral = toVectorLiteral(embedding);

  // Supplier scope cannot ride inside the ivfflat ORDER BY without dropping
  // valid in-scope rows that fall outside the probed lists, so over-fetch the
  // ANN (limit*5, capped at 50) and filter by supplier in app code below. The
  // restriction to this supplier's products is the false-leak guard.
  const fetchLimit = Math.min(limit * 5, 50);
  const [rows, scope] = await Promise.all([
    db
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
      .limit(fetchLimit),
    supplierProductIds(db, restaurantId, supplierId),
  ]);

  return rows
    .filter((row) => scope.has(row.productId))
    .map<MatchCandidate>((row) => ({
      productId: row.productId,
      canonicalName: row.canonicalName,
      confidence: Number(row.similarity),
      matchedBy: 'embedding',
    }))
    .filter((c) => c.confidence >= threshold)
    .slice(0, limit);
}

async function topNByFuzzy(
  db: Database,
  restaurantId: string,
  supplierId: string,
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
        // Supplier scope (false-leak guard): only products this supplier sells.
        supplierScopeSql(supplierId),
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
