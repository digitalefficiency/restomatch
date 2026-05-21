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
  suppliers,
  users,
} from '@restomatch/db';
import { MockEmbeddingProvider } from '../embeddings';
import {
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
    const match = await matchByAlias(db, supplierId, 'עגבניה שרי קילו');
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
    const match = await matchByAlias(db, supplierId, 'CHERRY TOMATO');
    expect(match?.productId).toBe(tomato.id);
  });

  it('returns null when no alias exists', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByAlias(db, supplierId, 'unknown product xyz');
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
    const match = await matchByAlias(db, altSupplierId, 'עגבניה שרי');
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
    const match = await matchByAlias(db, null, 'universal tomato');
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
    const match = await matchByAlias(db, supplierId, '  עגבניה שרי  ');
    expect(match?.productId).toBe(tomato.id);
  });
});

describe('matchByBarcode', () => {
  it('finds product by exact barcode', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const match = await matchByBarcode(db, restaurantId, '7290000000011');
    expect(match).toMatchObject({
      productId: tomato.id,
      canonicalName: 'עגבניה שרי',
      confidence: 1,
      matchedBy: 'barcode',
    });
  });

  it('returns null for unknown barcode', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByBarcode(db, restaurantId, '0000000000000');
    expect(match).toBeNull();
  });

  it('is restaurant-scoped (no cross-tenant leak)', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByBarcode(db, otherRestaurantId, '7290000000011');
    expect(match).toBeNull();
  });
});

describe('matchByEmbedding', () => {
  it('finds product when similar text embedding queried', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    // Same string → identical vector → similarity 1
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, restaurantId, queryEmbedding, 0.5);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.confidence).toBeGreaterThan(0.99);
    expect(match?.matchedBy).toBe('embedding');
  });

  it('finds product with similar-but-not-identical text', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const queryEmbedding = await embedder.embed('עגבניה שרי טריה');
    const match = await matchByEmbedding(db, restaurantId, queryEmbedding, 0.5);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when below threshold', async () => {
    await seedRestaurantWithProducts();
    const queryEmbedding = await embedder.embed('שווארמה כבש');
    const match = await matchByEmbedding(db, restaurantId, queryEmbedding, 0.95);
    expect(match).toBeNull();
  });

  it('is restaurant-scoped', async () => {
    await seedRestaurantWithProducts();
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const match = await matchByEmbedding(db, otherRestaurantId, queryEmbedding, 0.5);
    expect(match).toBeNull();
  });

  it('returns null for empty vector', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByEmbedding(db, restaurantId, [], 0.5);
    expect(match).toBeNull();
  });
});

describe('matchByFuzzy', () => {
  it('matches similar canonical name via pg_trgm', async () => {
    const { tomato } = await seedRestaurantWithProducts();
    const match = await matchByFuzzy(db, restaurantId, 'עגבניה שרי', 0.3);
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('fuzzy');
  });

  it('matches with minor typo', async () => {
    const { cucumber } = await seedRestaurantWithProducts();
    // typo: מלפפן instead of מלפפון
    const match = await matchByFuzzy(db, restaurantId, 'מלפפן חממה', 0.3);
    expect(match?.productId).toBe(cucumber.id);
  });

  it('returns null when no match meets threshold', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByFuzzy(db, restaurantId, 'completely unrelated text', 0.5);
    expect(match).toBeNull();
  });

  it('is restaurant-scoped', async () => {
    await seedRestaurantWithProducts();
    const match = await matchByFuzzy(db, otherRestaurantId, 'עגבניה שרי', 0.3);
    expect(match).toBeNull();
  });
});

describe('matchProduct (composite)', () => {
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
    const { tomato } = await seedRestaurantWithProducts();
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
    const { tomato } = await seedRestaurantWithProducts();
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
    const { tomato } = await seedRestaurantWithProducts();
    const match = await matchProduct(db, {
      restaurantId,
      supplierId,
      rawDescription: 'עגבניה שרי', // fuzzy match
    });
    expect(match?.productId).toBe(tomato.id);
    expect(match?.matchedBy).toBe('fuzzy');
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
    await seedRestaurantWithProducts();
    const queryEmbedding = await embedder.embed('עגבניה שרי');
    const candidates = await matchProductTopN(
      db,
      {
        restaurantId,
        supplierId: null,
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
    await seedRestaurantWithProducts();
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
    const ids = candidates.map((c) => c.productId);
    expect(new Set(ids).size).toBe(ids.length);
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
    const match = await matchByAlias(db, supplierId, 'cherry tomatoes 1kg');
    expect(match?.productId).toBe(tomato.id);
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
