import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  invoiceLines,
  invoices,
  matchRuns,
  discrepancies,
  memberships,
  poLines,
  priceBaselines,
  priceHistory,
  productAliases,
  products,
  purchaseOrders,
  restaurants,
  supplierCatalogItems,
  suppliers,
  users,
} from '@restomatch/db';
import { MockEmbeddingProvider } from '../embeddings';
import {
  matchBySku,
  matchByAlias,
  matchByBarcode,
  matchByEmbedding,
  matchByFuzzy,
  matchProduct,
  matchProductTopN,
} from '../matcher';
import { recordConfirmedMatch } from '../learning';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';

const db = createDb(TEST_DB_URL);
const embedder = new MockEmbeddingProvider(1536);

async function resetDb() {
  // Order matters — children before parents
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(priceBaselines);
  await db.delete(priceHistory);
  await db.delete(poLines);
  await db.delete(purchaseOrders);
  await db.delete(supplierCatalogItems);
  await db.delete(productAliases);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(memberships);
  await db.delete(users);
  await db.delete(restaurants);
}

let restaurantId: string;
let supplierId: string;
let altSupplierId: string;
let otherRestaurantId: string;

interface TestProduct {
  id: string;
  canonicalName: string;
}

async function seedRestaurantWithProducts(): Promise<{ tomato: TestProduct; cucumber: TestProduct; lettuce: TestProduct }> {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: 'Test Resto' })
    .returning();
  if (!restaurant) throw new Error('failed to create restaurant');
  restaurantId = restaurant.id;

  const [other] = await db
    .insert(restaurants)
    .values({ name: 'Other Resto' })
    .returning();
  if (!other) throw new Error('failed to create other restaurant');
  otherRestaurantId = other.id;

  const [s1, s2] = await db
    .insert(suppliers)
    .values([
      { restaurantId: restaurant.id, name: 'ירקני אבי' },
      { restaurantId: restaurant.id, name: 'ירקני בן' },
    ])
    .returning();
  if (!s1 || !s2) throw new Error('failed to create suppliers');
  supplierId = s1.id;
  altSupplierId = s2.id;

  // Embed canonical names so embedding tests work
  const tomatoEmbedding = await embedder.embed('עגבניה שרי');
  const cucumberEmbedding = await embedder.embed('מלפפון חממה');
  const lettuceEmbedding = await embedder.embed('חסה אייסברג');

  const inserted = await db
    .insert(products)
    .values([
      {
        restaurantId: restaurant.id,
        canonicalName: 'עגבניה שרי',
        category: 'ירקות',
        defaultUnit: 'ק״ג',
        barcodeEan: '7290000000011',
        embedding: tomatoEmbedding,
      },
      {
        restaurantId: restaurant.id,
        canonicalName: 'מלפפון חממה',
        category: 'ירקות',
        defaultUnit: 'ק״ג',
        embedding: cucumberEmbedding,
      },
      {
        restaurantId: restaurant.id,
        canonicalName: 'חסה אייסברג',
        category: 'ירקות',
        defaultUnit: 'יח׳',
        embedding: lettuceEmbedding,
      },
    ])
    .returning();

  const [tomato, cucumber, lettuce] = inserted;
  if (!tomato || !cucumber || !lettuce) throw new Error('failed to create products');
  return {
    tomato: { id: tomato.id, canonicalName: tomato.canonicalName },
    cucumber: { id: cucumber.id, canonicalName: cucumber.canonicalName },
    lettuce: { id: lettuce.id, canonicalName: lettuce.canonicalName },
  };
}

/**
 * Link products to a supplier so the supplier-scoped matchers (barcode,
 * embedding, fuzzy) treat them as candidates. Mirrors the production link:
 * a product is a candidate for supplier S iff S already sells it. Uses a
 * product_aliases row (the alias text is intentionally junk so it never
 * itself name-matches the queries under test).
 */
async function linkProductsToSupplier(
  supplier: string,
  productIds: string[],
): Promise<void> {
  await db.insert(productAliases).values(
    productIds.map((productId, i) => ({
      productId,
      supplierId: supplier,
      supplierNameRaw: `__scope_link_${supplier}_${i}__`,
      confidence: '1.000',
    })),
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
});

describe('matchByAlias', () => {
  it('finds product by exact supplier name', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי קילו',
      confidence: '1.000',
    });
    const match = await matchByAlias(db, restaurantId, supplierId,'עגבניה שרי קילו');
    expect(match).toMatchObject({
      productId: tomato.id,
      canonicalName: 'עגבניה שרי',
      confidence: 1,
      matchedBy: 'alias',
    });
  });

  it('is case-insensitive', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'Cherry Tomato',
      confidence: '1.000',
    });
    const match = await matchByAlias(db, restaurantId, supplierId,'CHERRY TOMATO');
    expect(match?.productId).toBe(tomato.id);
  });

  it('returns null when no alias exists', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByAlias(db, restaurantId, supplierId,'unknown product xyz');
    expect(match).toBeNull();
  });

  it('returns null when supplier does not match', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const match = await matchByAlias(db, restaurantId, altSupplierId,'עגבניה שרי');
    expect(match).toBeNull();
  });

  it('supports cross-supplier aliases (supplierId=null)', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId: null,
      supplierNameRaw: 'universal tomato',
      confidence: '0.900',
    });
    const match = await matchByAlias(db, restaurantId, null,'universal tomato');
    expect(match?.productId).toBe(tomato.id);
  });

  it('ignores leading/trailing whitespace', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const match = await matchByAlias(db, restaurantId, supplierId,'  עגבניה שרי  ');
    expect(match?.productId).toBe(tomato.id);
  });
});

describe('matchBySku (מק״ט, strategy-0)', () => {
  it('finds product by exact (supplier, sku) via product_aliases', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierSku: '300099',
      supplierNameRaw: 'עגבניה שרי קילו',
      confidence: '1.000',
    });
    const match = await matchBySku(db, restaurantId, supplierId, '300099');
    expect(match).toMatchObject({
      productId: tomato.id,
      canonicalName: 'עגבניה שרי',
      confidence: 1,
      matchedBy: 'sku',
    });
  });

  it('requires a supplierId — a SKU is meaningless without it', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierSku: '300099',
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const match = await matchBySku(db, restaurantId, null, '300099');
    expect(match).toBeNull();
  });

  it('is scoped by supplier — same SKU, different supplier does not collide', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierSku: '100003',
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    // Same SKU number, asked for under a different supplier → no match.
    const match = await matchBySku(db, restaurantId, altSupplierId, '100003');
    expect(match).toBeNull();
  });

  it('falls back to a linked supplier_catalog_items row when no alias exists', async () => {
    const { cucumber } = await seedRestaurantWithProducts();
    await db.insert(supplierCatalogItems).values({
      restaurantId,
      supplierId,
      productId: cucumber.id,
      supplierSku: '500500',
      supplierNameRaw: 'מלפפון ארגז',
      unit: 'ק״ג',
      listPrice: '12.5000',
    });
    const match = await matchBySku(db, restaurantId, supplierId, '500500');
    expect(match?.productId).toBe(cucumber.id);
    expect(match?.matchedBy).toBe('sku');
  });

  it('ignores an unlinked (productId=null) catalog item', async () => {
    await seedRestaurantWithProducts();
    await db.insert(supplierCatalogItems).values({
      restaurantId,
      supplierId,
      productId: null,
      supplierSku: '777',
      supplierNameRaw: 'מוצר לא ממופה',
      unit: 'ק״ג',
    });
    const match = await matchBySku(db, restaurantId, supplierId, '777');
    expect(match).toBeNull();
  });

  it('does not leak across tenants — alias product in another restaurant is invisible', async () => {
    await seedRestaurantWithProducts();
    // A product + SKU alias that belong to the OTHER restaurant.
    const [otherProduct] = await db
      .insert(products)
      .values({ restaurantId: otherRestaurantId, canonicalName: 'מוצר של מסעדה אחרת' })
      .returning();
    if (!otherProduct) throw new Error('failed to create other-restaurant product');
    await db.insert(productAliases).values({
      productId: otherProduct.id,
      supplierId,
      supplierSku: '300099',
      supplierNameRaw: 'foreign',
      confidence: '1.000',
    });
    // Querying as OUR restaurant must not surface the other tenant's product.
    const match = await matchBySku(db, restaurantId, supplierId, '300099');
    expect(match).toBeNull();
  });

  it('trims whitespace and returns null for empty/unknown sku', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierSku: '300099',
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    expect((await matchBySku(db, restaurantId, supplierId, '  300099  '))?.productId).toBe(
      tomato.id,
    );
    expect(await matchBySku(db, restaurantId, supplierId, '   ')).toBeNull();
    expect(await matchBySku(db, restaurantId, supplierId, '999999')).toBeNull();
  });
});

describe('matchByBarcode', () => {
  it('finds product by exact barcode when the supplier sells it', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    // Supplier-scope: the supplier must already sell the product (alias link).
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const match = await matchByBarcode(db, restaurantId, supplierId, '7290000000011');
    expect(match).toMatchObject({
      productId: tomato.id,
      canonicalName: 'עגבניה שרי',
      confidence: 1,
      matchedBy: 'barcode',
    });
  });

  it('returns null for unknown barcode', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByBarcode(db, restaurantId, supplierId, '0000000000000');
    expect(match).toBeNull();
  });

  it('is restaurant-scoped (no cross-tenant leak)', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByBarcode(db, otherRestaurantId, supplierId, '7290000000011');
    expect(match).toBeNull();
  });

  it('returns null without a supplier — a barcode is unscoped', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const match = await matchByBarcode(db, restaurantId, null, '7290000000011');
    expect(match).toBeNull();
  });

  it('is supplier-scoped: supplier B cannot match supplier A-only product by barcode', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    // Tomato is only linked to supplierId (via alias), NOT altSupplierId.
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    // altSupplier scans the same barcode → must NOT resolve to A's product.
    const match = await matchByBarcode(db, restaurantId, altSupplierId, '7290000000011');
    expect(match).toBeNull();
    // Sanity: the owning supplier still matches.
    const owned = await matchByBarcode(db, restaurantId, supplierId, '7290000000011');
    expect(owned?.productId).toBe(tomato.id);
  });
});

describe('matchByEmbedding', () => {
  it('finds product when similar text embedding queried', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    // Same string → identical vector → similarity 1
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, restaurantId, supplierId, queryEmbedding, 0.5);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.confidence).toBeGreaterThan(0.99);
    expect(match?.matchedBy).toBe('embedding');
  });

  it('finds product with similar-but-not-identical text', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי טריה');
    const match = await matchByEmbedding(db, restaurantId, supplierId, queryEmbedding, 0.5);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when below threshold', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('שווארמה כבש');
    const match = await matchByEmbedding(db, restaurantId, supplierId, queryEmbedding, 0.95);
    expect(match).toBeNull();
  });

  it('is restaurant-scoped', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, otherRestaurantId, supplierId, queryEmbedding, 0.5);
    expect(match).toBeNull();
  });

  it('returns null for empty vector', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByEmbedding(db, restaurantId, supplierId, [], 0.5);
    expect(match).toBeNull();
  });

  it('returns null without a supplier — embedding candidates are unscoped', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, restaurantId, null, queryEmbedding, 0.5);
    expect(match).toBeNull();
  });

  it('is supplier-scoped: supplier B cannot embed-match supplier A-only product', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // All products belong ONLY to supplierId, none to altSupplierId.
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, restaurantId, altSupplierId, queryEmbedding, 0.5);
    expect(match).toBeNull();
    // Sanity: the owning supplier still matches.
    const owned = await matchByEmbedding(db, restaurantId, supplierId, queryEmbedding, 0.5);
    expect(owned?.productId).toBe(tomato.id);
  });

  it('over-fetches the ANN so an in-scope product behind closer out-of-scope rows is not dropped', async () => {
    // Regression for the no-under-fetch ANN case: if the supplier predicate
    // rode inside a LIMIT 1 ORDER BY, the single nearest row (out-of-scope)
    // would be returned then filtered away, yielding NO match even though an
    // in-scope product exists slightly further out. Over-fetch must surface it.
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // The NEAREST product to the query (cucumber's exact name) belongs to the
    // OTHER supplier; the in-scope supplier only sells the (further) tomato.
    await linkProductsToSupplier(altSupplierId, [cucumber.id]);
    await linkProductsToSupplier(supplierId, [tomato.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('מלפפון חממה'); // nearest = cucumber (out of scope)
    const match = await matchByEmbedding(db, restaurantId, supplierId, queryEmbedding, 0.1);
    // Must skip the closer out-of-scope cucumber and still return an in-scope
    // product (tomato or lettuce) rather than null.
    expect(match).not.toBeNull();
    expect([tomato.id, lettuce.id]).toContain(match?.productId);
  });
});

describe('matchByFuzzy', () => {
  it('matches similar canonical name via pg_trgm', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchByFuzzy(db, restaurantId, supplierId, 'עגבניה שרי', 0.3);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('fuzzy');
  });

  it('matches with minor typo', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    // typo: מלפפן instead of מלפפון
    const match = await matchByFuzzy(db, restaurantId, supplierId, 'מלפפן חממה', 0.3);
    expect(match?.productId).toBe(cucumber.id);
  });

  it('returns null when no match meets threshold', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchByFuzzy(db, restaurantId, supplierId, 'completely unrelated text', 0.5);
    expect(match).toBeNull();
  });

  it('is restaurant-scoped', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchByFuzzy(db, otherRestaurantId, supplierId, 'עגבניה שרי', 0.3);
    expect(match).toBeNull();
  });

  it('returns null without a supplier — fuzzy candidates are unscoped', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchByFuzzy(db, restaurantId, null, 'עגבניה שרי', 0.3);
    expect(match).toBeNull();
  });

  it('is supplier-scoped: supplier B cannot fuzzy-match supplier A-only product', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // Products belong ONLY to supplierId.
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchByFuzzy(db, restaurantId, altSupplierId, 'עגבניה שרי', 0.3);
    expect(match).toBeNull();
    // Sanity: the owning supplier still matches.
    const owned = await matchByFuzzy(db, restaurantId, supplierId, 'עגבניה שרי', 0.3);
    expect(owned?.productId).toBe(tomato.id);
  });
});

describe('matchProduct (composite)', () => {
  it('prefers SKU (strategy-0) over alias/embedding/fuzzy', async () => {
    const { tomato, cucumber } = await seedRestaurantWithProducts();
    // Name-alias points to cucumber; SKU points to tomato. SKU must win.
    await db.insert(productAliases).values([
      {
        productId: cucumber.id,
        supplierId,
        supplierNameRaw: 'מארז מעורב',
        confidence: '1.000',
      },
      {
        productId: tomato.id,
        supplierId,
        supplierSku: '300099',
        supplierNameRaw: 'עגבניה שרי קילו',
        confidence: '1.000',
      },
    ]);
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      supplierSku: '300099',
      rawDescription: 'מארז מעורב', // would alias-match cucumber
    });
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('sku');
  });

  it('falls through SKU → alias when the sku is unknown', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי קילו',
      confidence: '1.000',
    });
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      supplierSku: 'no-such-sku',
      rawDescription: 'עגבניה שרי קילו',
    });
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('alias');
  });

  it('prefers alias over other strategies', async () => {
    const { tomato, cucumber } = await seedRestaurantWithProducts();
    // Alias points to cucumber, even though embedding/fuzzy would point to tomato
    await db.insert(productAliases).values({
      productId: cucumber.id,
      supplierId,
      supplierNameRaw: 'עגבניה שרי',
      confidence: '1.000',
    });
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'עגבניה שרי',
      embedding: queryEmbedding,
    });
    expect(match?.productId).toBe(cucumber.id);
    expect(match?.matchedBy).toBe('alias');
    // Sanity: without alias, would match tomato via embedding
    expect(tomato.id).not.toBe(cucumber.id);
  });

  it('falls through alias → barcode', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'unknown name',
      barcode: '7290000000011',
    });
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('barcode');
  });

  it('falls through alias → barcode → embedding', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    // Use an embedding from the exact canonical name → guaranteed similarity ≈ 1
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchProduct(
      db,
      {
        restaurantId,
        supplierId,
        rawDescription: 'unrelated-string-here-xyz-123',
        embedding: queryEmbedding,
      },
      { embeddingMinSimilarity: 0.85, fuzzyMinSimilarity: 0.95 },
    );
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('embedding');
  });

  it('falls through alias → barcode → embedding → fuzzy', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'עגבניה שרי', // fuzzy match
    });
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('fuzzy');
  });

  it('false-leak guard: invoice from supplier A must NOT match supplier B-only product', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // Every product is sold ONLY by supplierId (supplier A).
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    // An invoice line from altSupplierId (supplier B) for the SAME goods —
    // exact name, exact barcode, exact embedding. None may resolve, because B
    // does not sell any of these products; matching anyway would raise a
    // phantom cross-supplier price-leak.
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchProduct(db, {
      restaurantId,
      supplierId: altSupplierId,
      rawDescription: 'עגבניה שרי',
      barcode: '7290000000011',
      embedding: queryEmbedding,
    });
    expect(match).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    await seedRestaurantWithProducts();
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'completely-unrelated-product-xyz-123',
    });
    expect(match).toBeNull();
  });
});

describe('matchProductTopN', () => {
  it('returns multiple candidates ranked by confidence', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId,
        rawDescription: 'עגבניה שרי',
        embedding: queryEmbedding,
      },
      3,
      { embeddingMinSimilarity: 0.1, fuzzyMinSimilarity: 0.1 },
    );
    expect(candidates.length).toBeGreaterThan(0);
    // Sorted descending by confidence
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1]!.confidence).toBeGreaterThanOrEqual(candidates[i]!.confidence);
    }
  });

  it('short-circuits to alias when it exists', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    await db.insert(productAliases).values({
      productId: tomato.id,
      supplierId,
      supplierNameRaw: 'cherry tomato',
      confidence: '1.000',
    });
    const candidates = await matchProductTopN(db, {
      restaurantId,
      supplierId,
      rawDescription: 'cherry tomato',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.matchedBy).toBe('alias');
  });

  it('deduplicates products that match via both embedding and fuzzy', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId,
        rawDescription: 'עגבניה שרי',
        embedding: queryEmbedding,
      },
      5,
      { embeddingMinSimilarity: 0.1, fuzzyMinSimilarity: 0.1 },
    );
    const ids = candidates.map((c) => c.productId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns [] for a null/unknown supplier (false-leak guard)', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId: null,
        rawDescription: 'עגבניה שרי',
        embedding: queryEmbedding,
      },
      5,
      { embeddingMinSimilarity: 0.1, fuzzyMinSimilarity: 0.1 },
    );
    expect(candidates).toEqual([]);
  });

  it('returns only same-supplier candidates (no cross-supplier leak)', async () => {
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // Products are sold ONLY by supplierId; query under altSupplierId.
    await linkProductsToSupplier(supplierId, [tomato.id, cucumber.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId: altSupplierId,
        rawDescription: 'עגבניה שרי',
        embedding: queryEmbedding,
      },
      5,
      { embeddingMinSimilarity: 0.1, fuzzyMinSimilarity: 0.1 },
    );
    expect(candidates).toEqual([]);
  });

  it('over-fetches the ANN: an in-scope product is returned even behind closer out-of-scope rows', async () => {
    // no-under-fetch ANN regression at the top-N layer.
    const { tomato, cucumber, lettuce } = await seedRestaurantWithProducts();
    // Nearest match to the query belongs to the other supplier; in-scope
    // supplier sells only the further products.
    await linkProductsToSupplier(altSupplierId, [cucumber.id]);
    await linkProductsToSupplier(supplierId, [tomato.id, lettuce.id]);
    const queryEmbedding = await embedder.embed('מלפפון חממה'); // nearest = cucumber (out of scope)
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId,
        rawDescription: 'מלפפון חממה',
        embedding: queryEmbedding,
      },
      3,
      { embeddingMinSimilarity: 0.1, fuzzyMinSimilarity: 0.1 },
    );
    expect(candidates.length).toBeGreaterThan(0);
    // The closer cucumber (other supplier) must never appear.
    expect(candidates.map((c) => c.productId)).not.toContain(cucumber.id);
    for (const c of candidates) {
      expect([tomato.id, lettuce.id]).toContain(c.productId);
    }
  });
});

describe('recordConfirmedMatch (learning loop)', () => {
  it('creates new alias on first confirmation', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const result = await recordConfirmedMatch(db, {
      productId: tomato.id,
      supplierId,
      rawName: 'cherry tomatoes 1kg',
    });
    expect(result.created).toBe(true);
    expect(result.aliasId).toBeTruthy();

    // Now subsequent matchByAlias should find it
    const match = await matchByAlias(db, restaurantId, supplierId,'cherry tomatoes 1kg');
    expect(match?.productId).toBe(tomato.id);
  });

  it('backfills supplier_sku onto an existing name alias, enabling matchBySku', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    // First confirmation by name only — no SKU yet.
    const first = await recordConfirmedMatch(db, {
      productId: tomato.id,
      supplierId,
      rawName: 'עגבניה שרי קילו',
    });
    expect(first.created).toBe(true);
    expect(await matchBySku(db, restaurantId, supplierId, '300099')).toBeNull();

    // Re-confirm the SAME name, now carrying the SKU → must update in place.
    const second = await recordConfirmedMatch(db, {
      productId: tomato.id,
      supplierId,
      rawName: 'עגבניה שרי קילו',
      supplierSku: '300099',
    });
    expect(second.created).toBe(false);
    expect(second.aliasId).toBe(first.aliasId);

    // The SKU now resolves at confidence 1.
    const bySku = await matchBySku(db, restaurantId, supplierId, '300099');
    expect(bySku?.productId).toBe(tomato.id);
  });

  it('updates confidence on re-confirmation', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const first = await recordConfirmedMatch(db, {
      productId: tomato.id,
      supplierId,
      rawName: 'cherry tomato',
      confidence: 0.7,
    });
    expect(first.created).toBe(true);

    const second = await recordConfirmedMatch(db, {
      productId: tomato.id,
      supplierId,
      rawName: 'cherry tomato',
      confidence: 1.0,
    });
    expect(second.created).toBe(false);
    expect(second.aliasId).toBe(first.aliasId);
  });

  it('integration: scan-confirm-rescan finds via alias on second run', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const queryEmbedding = await embedder.embed('עגבניה אורגנית');

    // First scan: no alias, fall through to embedding
    const first = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'עגבניה אורגנית',
      embedding: queryEmbedding,
    });
    // May or may not match via embedding; if it doesn't, simulate human confirmation
    if (!first) {
      await recordConfirmedMatch(db, {
        productId: tomato.id,
        supplierId,
        rawName: 'עגבניה אורגנית',
      });
    } else {
      // simulate the user confirming the suggested match
      await recordConfirmedMatch(db, {
        productId: first.productId,
        supplierId,
        rawName: 'עגבניה אורגנית',
      });
    }

    // Second scan: should match via alias (confidence 1)
    const second = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'עגבניה אורגנית',
    });
    expect(second?.matchedBy).toBe('alias');
    expect(second?.confidence).toBe(1);
  });
});
