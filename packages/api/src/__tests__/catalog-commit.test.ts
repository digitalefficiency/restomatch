import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  and,
  catalogImports,
  createDb,
  eq,
  productAliases,
  products,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { MockEmbeddingProvider } from '@restomatch/catalog';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { commitCatalogRows } from '../catalog/commit';
import { catalogUnitPrice, cheapestComparable } from '../lib/unitPrice';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W1-10 · price-list money safety. The import must never turn a guess into a
 * fact: a medium-confidence or unit/pack-mismatched match is saved UNLINKED
 * with no alias (catalog-01), prices parse strictly at the boundary (catalog-02),
 * the VAT basis is applied and stored (catalog-37), and "הזול ביותר" compares
 * like with like through the one catalogUnitPrice the sweep uses (catalog-13).
 */
type Candidate = { productId: string; canonicalName: string; confidence: number; matchedBy: string };
const nextCandidate: { value: Candidate | null } = { value: null };
vi.mock('@restomatch/catalog', async (orig) => {
  const real = await orig<typeof import('@restomatch/catalog')>();
  return {
    ...real,
    matchProductTopN: async (...args: Parameters<typeof real.matchProductTopN>) =>
      nextCandidate.value ? [nextCandidate.value] : real.matchProductTopN(...args),
  };
});
const enqueueCatalogImport = vi.fn(async (_p: unknown) => true);
vi.mock('@restomatch/queue', async (orig) => ({
  ...(await orig<typeof import('@restomatch/queue')>()),
  enqueueCatalogImport: (p: unknown) => enqueueCatalogImport(p),
}));

const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

const row = (over: Partial<Parameters<typeof commitCatalogRows>[2][number]> = {}) => ({
  supplierSku: null,
  supplierNameRaw: 'עגבניה שרי מובחרת',
  unit: 'ק״ג',
  listPrice: 12.5,
  barcodeEan: null,
  packSize: null,
  ...over,
});

async function aliasesFor(raw: string) {
  return db
    .select({ productId: productAliases.productId, confidence: productAliases.confidence })
    .from(productAliases)
    .where(eq(productAliases.supplierNameRaw, raw));
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  nextCandidate.value = null;
  enqueueCatalogImport.mockClear();
});
afterAll(() => resetDb(db));

describe('commitCatalogRows: suggest, never link a guess (catalog-01)', () => {
  const args = () => ({ restaurantId: A.restaurantId, supplierId: A.supplierId });

  it('a 0.6–0.9 match is saved unlinked, with no alias, and listed for review', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.75, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row()], embedder);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0]).toMatchObject({
      productId: A.productId,
      confidence: 0.75,
      reasons: ['MEDIUM_CONFIDENCE'],
      productUnit: 'ק״ג',
    });
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, res.ambiguous[0]!.itemId));
    expect(item?.productId).toBeNull();
    expect(await aliasesFor('עגבניה שרי מובחרת')).toEqual([]);
    expect(res.createdProducts).toBe(0);
  });

  it('a ≥0.95 match with the same unit links, learning the alias at its real confidence (not 1)', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.97, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row()], embedder);
    expect(res.ambiguous).toEqual([]);
    const aliases = await aliasesFor('עגבניה שרי מובחרת');
    expect(aliases).toEqual([{ productId: A.productId, confidence: '0.970' }]);
  });

  it('a 0.9–0.95 match is a suggestion, not a link (auto-link floor 0.95)', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.93, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row()], embedder);
    expect(res.ambiguous[0]?.reasons).toEqual(['MEDIUM_CONFIDENCE']);
    expect(await aliasesFor('עגבניה שרי מובחרת')).toEqual([]);
  });

  it('an exact (confidence 1) machine match is still stored below 1.000 — that is reserved for a person', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 1, matchedBy: 'sku' };
    await commitCatalogRows(db, args(), [row({ supplierSku: 'S-EXACT' })], embedder);
    expect(await aliasesFor('עגבניה שרי מובחרת')).toEqual([{ productId: A.productId, confidence: '0.999' }]);
  });

  it('a high-confidence match in a unit that does not convert goes to review (UNIT_MISMATCH)', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.97, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row({ unit: 'ארגז' })], embedder);
    expect(res.ambiguous[0]?.reasons).toEqual(['UNIT_MISMATCH']);
    expect(await aliasesFor('עגבניה שרי מובחרת')).toEqual([]);
  });

  it('a convertible unit (גרם vs ק״ג) is not a mismatch', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.97, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row({ unit: 'גרם' })], embedder);
    expect(res.ambiguous).toEqual([]);
  });

  it('a pack size other than the one the supplier already sells goes to review (PACK_MISMATCH)', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'עגבניה ארגז 24',
      packSize: '24',
      listPrice: '100',
    });
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 1, matchedBy: 'alias' };
    const res = await commitCatalogRows(db, args(), [row({ packSize: 6 })], embedder);
    expect(res.ambiguous[0]?.reasons).toEqual(['PACK_MISMATCH']);
  });

  it('below the review floor a new product is made from the row, alias at machine confidence 0.999', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.4, matchedBy: 'fuzzy' };
    const res = await commitCatalogRows(db, args(), [row({ supplierNameRaw: 'פטרוזיליה' })], embedder);
    expect(res.createdProducts).toBe(1);
    const aliases = await aliasesFor('פטרוזיליה');
    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.confidence).toBe('0.999');
    expect(aliases[0]!.productId).not.toBe(A.productId);
  });

  it('writes progress to the import row for a background import', async () => {
    const [imp] = await db
      .insert(catalogImports)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, filename: 'big.csv', rowCount: 30 })
      .returning({ id: catalogImports.id });
    const rows = Array.from({ length: 30 }, (_, i) => row({ supplierNameRaw: `פריט ${i}`, supplierSku: `S-${i}` }));
    await commitCatalogRows(db, { ...args(), sourceImportId: imp!.id }, rows, embedder);
    const [after] = await db.select().from(catalogImports).where(eq(catalogImports.id, imp!.id));
    expect(after!.createdItems).toBe(25); // last progress write; the worker writes the final count
  });
});

describe('catalog.commitImport / parsePreview (catalog-02 / -18 / -37)', () => {
  const text =
    'מק"ט,תיאור,יחידה,מחיר\n' +
    'P-1,שמן זית 18 ליטר,יח׳,"1,250"\n' +
    'P-2,אורז יסמין,ק"ג,"12,90"\n' +
    'P-3,מלח ים,ק"ג,-5\n' +
    'P-4,סוכר,ק"ג,"₪ 2,400"\n';
  const file = { filename: 'מחירון.csv', text };
  const mapping = { sku: 'מק"ט', name: 'תיאור', unit: 'יחידה', price: 'מחיר' };

  const price = async (sku: string) => {
    const [it] = await db
      .select({ listPrice: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
    return it?.listPrice ?? null;
  };

  it('stores "1,250" as ₪1,250.00 and holds "-5" out as an unclear price', async () => {
    const res = await callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file, mapping, vatBasis: 'ex' });
    expect(res.rowCount).toBe(3);
    expect(res.heldCount).toBe(1);
    expect(res.held[0]).toMatchObject({ supplierSku: 'P-3', rawPrice: '-5', reason: 'UNCLEAR_PRICE' });
    expect(await price('P-1')).toBe('1250.0000');
    expect(await price('P-2')).toBe('12.9000');
    expect(await price('P-4')).toBe('2400.0000');
    expect(await price('P-3')).toBeNull();
  });

  it('a VAT-inclusive list is stored ex-VAT at the restaurant rate, and the choice is kept with the mapping', async () => {
    const res = await callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file, mapping, vatBasis: 'inc' });
    expect(await price('P-1')).toBe('1059.3220'); // 1250 / 1.18, half-up at 4 dp
    const [imp] = await db.select().from(catalogImports).where(eq(catalogImports.id, res.importId));
    expect(imp!.columnMapping).toMatchObject({ ...mapping, vatBasis: 'inc', vatRate: '0.1800' });
  });

  it('the preview shows the parsed ₪, the held rows, and flags against the current price', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'P-2',
      supplierNameRaw: 'אורז יסמין',
      listPrice: '1.5', // 12.90 is > 5× this
    });
    const csv = text + 'P-5,קמח,ק"ג,0\n';
    const pre = await callerFor(A).catalog.parsePreview({ supplierId: A.supplierId, file: { filename: 'p.csv', text: csv } });
    expect(pre.vatBasisDetected).toBeNull();
    expect(pre.check.committable).toBe(4);
    expect(pre.check.heldCount).toBe(1);
    expect(pre.check.rows.map((r) => [r.supplierSku, r.price, r.flag])).toEqual([
      ['P-1', 1250, null],
      ['P-2', 12.9, 'HIGH'],
      ['P-4', 2400, null],
      ['P-5', 0, 'ZERO'],
    ]);
    expect(pre.check.flaggedCount).toBe(2);
  });

  it('pre-sets the VAT basis from a "כולל מע״מ" header', async () => {
    const pre = await callerFor(A).catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: 'תיאור,מחיר כולל מע"מ\nשמן,118\n' },
    });
    expect(pre.vatBasisDetected).toBe('inc');
    expect(pre.check.rows[0]?.price).toBe(100);
  });

  it('more than 200 rows go to the background job (determinate progress), not inline', async () => {
    const big = 'תיאור,מחיר\n' + Array.from({ length: 201 }, (_, i) => `פריט ${i},${i + 1}`).join('\n');
    const res = await callerFor(A).catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'big.csv', text: big },
      mapping: { name: 'תיאור', price: 'מחיר' },
      vatBasis: 'ex',
    });
    expect(res.queued).toBe(true);
    expect(enqueueCatalogImport).toHaveBeenCalledTimes(1);
    const payload = enqueueCatalogImport.mock.calls[0]![0] as { mapping: Record<string, string> };
    expect(payload.mapping).toMatchObject({ vatBasis: 'ex', vatRate: '0.1800' });
  });
});

describe('catalog.updateItem: a person accepts / chooses / makes new (catalog-01 review)', () => {
  async function unlinkedItem() {
    const [it] = await db
      .insert(supplierCatalogItems)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, supplierNameRaw: 'עגבניה שרי', supplierSku: 'Q-1', unit: 'ק״ג' })
      .returning({ id: supplierCatalogItems.id });
    return it!.id;
  }

  it('accept links and learns the alias (a human confirm = confidence 1)', async () => {
    const itemId = await unlinkedItem();
    await callerFor(A).catalog.updateItem({ itemId, patch: { productId: A.productId } });
    expect(await aliasesFor('עגבניה שרי')).toEqual([{ productId: A.productId, confidence: '1.000' }]);
  });

  it('"מוצר חדש" creates a product owned by the supplier and links it', async () => {
    const itemId = await unlinkedItem();
    const res = await callerFor(A).catalog.updateItem({ itemId, patch: { newProductName: 'עגבניה שרי' } });
    const [p] = await db.select().from(products).where(eq(products.id, res.productId!));
    expect(p).toMatchObject({ restaurantId: A.restaurantId, supplierId: A.supplierId, canonicalName: 'עגבניה שרי', defaultUnit: 'ק״ג' });
  });

  it('a foreign item is NOT_FOUND and creates nothing', async () => {
    const B = await seedTenant(db, 'B');
    const itemId = await unlinkedItem();
    await expect(
      callerFor(B).catalog.updateItem({ itemId, patch: { newProductName: 'זר' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(products).where(eq(products.canonicalName, 'זר'))).toEqual([]);
  });
});

describe('one catalogUnitPrice for the sweep and the product page (catalog-13)', () => {
  it('per default unit; packs and non-converting units are not comparable', () => {
    expect(catalogUnitPrice({ listPrice: '9.80', unit: 'ק״ג', packSize: null, productUnit: 'ק"ג' })).toBe(9.8);
    expect(catalogUnitPrice({ listPrice: '0.98', unit: 'גרם', packSize: null, productUnit: 'ק״ג' })).toBe(980);
    expect(catalogUnitPrice({ listPrice: '120', unit: 'ארגז', packSize: '24', productUnit: 'ק״ג' })).toBeNull();
    expect(catalogUnitPrice({ listPrice: '50', unit: 'ארגז', packSize: null, productUnit: 'ק״ג' })).toBeNull();
    expect(cheapestComparable([9.8, null])).toBeNull();
    expect(cheapestComparable([9.8, 10.2, null])).toBe(9.8);
  });

  it('the sweep has no private copy of the formula (parity by construction)', () => {
    const sweep = readFileSync(fileURLToPath(new URL('../priceAlerts/sweep.ts', import.meta.url)), 'utf8');
    expect(sweep).toMatch(/import \{ catalogUnitPrice \} from '\.\.\/lib\/unitPrice'/);
    expect(sweep).not.toMatch(/function catalogUnitPrice/);
  });

  it('productDetail: a pack price never wins "cheapest" against a kilo price', async () => {
    const B2 = await db
      .insert((await import('@restomatch/db')).suppliers)
      .values({ restaurantId: A.restaurantId, name: 'ספק שני' })
      .returning();
    await db.insert(supplierCatalogItems).values([
      { restaurantId: A.restaurantId, supplierId: A.supplierId, productId: A.productId, supplierNameRaw: 'עגבניה', unit: 'ק״ג', listPrice: '9.80' },
      { restaurantId: A.restaurantId, supplierId: B2[0]!.id, productId: A.productId, supplierNameRaw: 'עגבניה ארגז', unit: 'ארגז', packSize: '10', listPrice: '5' },
    ]);
    let d = await callerFor(A).catalog.productDetail({ productId: A.productId });
    expect(d!.items.map((i) => i.unitPricePerDefaultUnit).sort()).toEqual([9.8, null].sort());
    expect(d!.cheapestUnitPrice).toBeNull(); // one comparable price is not a comparison
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: B2[0]!.id,
      productId: A.productId,
      supplierNameRaw: 'עגבניה גרם',
      unit: 'גרם',
      listPrice: '0.0095',
    });
    d = await callerFor(A).catalog.productDetail({ productId: A.productId });
    expect(d!.cheapestUnitPrice).toBe(9.5);
  });
});

// ── W1-10 review fixes ─────────────────────────────────────────────────────────
describe('review: VAT basis + rate, flagged prices, aliases, packs', () => {
  const mapping = { sku: 'מק"ט', name: 'תיאור', price: 'מחיר' };
  const priceOf = async (sku: string) => {
    const [it] = await db
      .select({ listPrice: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.restaurantId, A.restaurantId), eq(supplierCatalogItems.supplierSku, sku)));
    return it?.listPrice ?? null;
  };

  it('finding 1: "כולל מע״מ" on ANOTHER column does not pre-set the price basis', async () => {
    const pre = await callerFor(A).catalog.parsePreview({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: 'תיאור,מחיר,הובלה כולל מע"מ\nשמן,100,20\n' },
    });
    expect(pre.mapping.price).toBe('מחיר');
    expect(pre.vatBasisDetected).toBeNull();
    expect(pre.check.rows[0]?.price).toBe(100);
  });

  it('finding 2: an inc-VAT list converts at the SUPPLIER\'s override rate, as the engine does', async () => {
    await db.update(suppliers).set({ vatRate: '0.17' }).where(eq(suppliers.id, A.supplierId));
    const res = await callerFor(A).catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: 'מק"ט,תיאור,מחיר\nV-1,שמן,"1,250"\n' },
      mapping,
      vatBasis: 'inc',
    });
    expect(await priceOf('V-1')).toBe('1068.3761'); // 1250 / 1.17, half-up at 4 dp
    const [imp] = await db.select().from(catalogImports).where(eq(catalogImports.id, res.importId));
    expect(imp!.columnMapping).toMatchObject({ vatBasis: 'inc', vatRate: '0.1700' });
  });

  it('finding 7: a flagged price is refused unless confirmed — re-checked on the committed file', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      supplierSku: 'F-1',
      supplierNameRaw: 'אורז',
      listPrice: '2',
    });
    const file = { filename: 'p.csv', text: 'מק"ט,תיאור,מחיר\nF-1,אורז,"1,250"\n' };
    await expect(
      callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file, mapping, vatBasis: 'ex' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/^CATALOG_FLAGGED_PRICES/) });
    expect(await priceOf('F-1')).toBe('2.0000');
    await callerFor(A).catalog.commitImport({ supplierId: A.supplierId, file, mapping, vatBasis: 'ex', confirmFlagged: true });
    expect(await priceOf('F-1')).toBe('1250.0000');
  });

  it('finding 10: re-linking a row supersedes the old alias of the same SKU (one SKU, one product)', async () => {
    const [other] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, canonicalName: 'מוצר אחר' })
      .returning({ id: products.id });
    const [it] = await db
      .insert(supplierCatalogItems)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, supplierNameRaw: 'עגבניה שרי', supplierSku: 'Q-9' })
      .returning({ id: supplierCatalogItems.id });
    await callerFor(A).catalog.updateItem({ itemId: it!.id, patch: { productId: A.productId } });
    await callerFor(A).catalog.updateItem({ itemId: it!.id, patch: { productId: other!.id } });
    const aliases = await db
      .select({ productId: productAliases.productId })
      .from(productAliases)
      .where(and(eq(productAliases.supplierId, A.supplierId), eq(productAliases.supplierSku, 'Q-9')));
    expect(aliases).toEqual([{ productId: other!.id }]);
  });

  it('finding 11: a pack row vs the supplier\'s UNPACKED row of the product is a pack mismatch', async () => {
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: A.productId,
      supplierNameRaw: 'עגבניה',
      listPrice: '9',
    });
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 1, matchedBy: 'alias' };
    const res = await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId },
      [row({ packSize: 6 })],
      embedder,
    );
    expect(res.ambiguous[0]?.reasons).toEqual(['PACK_MISMATCH']);
  });

  it('finding 4: the review persists — imports report their unlinked rows until each is resolved', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'עגבניה A', confidence: 0.75, matchedBy: 'fuzzy' };
    const res = await callerFor(A).catalog.commitImport({
      supplierId: A.supplierId,
      file: { filename: 'p.csv', text: 'מק"ט,תיאור,מחיר\nR-1,עגבניה שרי מובחרת,9\n' },
      mapping,
      vatBasis: 'ex',
    });
    const listed = async () =>
      (await callerFor(A).catalog.imports({ supplierId: A.supplierId })).find((i) => i.id === res.importId)!.unlinkedItems;
    expect(await listed()).toBe(1);
    const queue = await callerFor(A).catalog.items({ importId: res.importId, unlinkedOnly: true });
    expect(queue.map((i) => i.supplierSku)).toEqual(['R-1']);
    await callerFor(A).catalog.updateItem({ itemId: queue[0]!.id, patch: { productId: A.productId } });
    expect(await listed()).toBe(0);
  });
});
