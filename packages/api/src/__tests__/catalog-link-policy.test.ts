import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  productAliases,
  products,
  supplierCatalogItems,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { decideLink, matchProductTopN, MockEmbeddingProvider, type LinkCandidate } from '@restomatch/catalog';
import { runOcrPipeline, StubOcrProvider } from '@restomatch/ocr';
// Test-only deep imports: the default decider + the OCR stub fixture (the stub
// provider only; real OCR is credential-gated).
import { defaultOcrLinkDecider } from '../../../ocr/src/pipeline';
import { AGREEMENT_PERFECT } from '../../../ocr/src/__tests__/fixtures';
import { commitCatalogRows } from '../catalog/commit';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * G-08 · ONE link policy. The same candidate set gives the same decision through
 * the catalog import, OCR (policy injected) and a direct `decideLink` call; the
 * OCR default (no policy injected) only ever auto-links where `decideLink` does.
 */

const nextCandidate: { value: LinkCandidate | null } = { value: null };
vi.mock('@restomatch/catalog', async (orig) => {
  const real = await orig<typeof import('@restomatch/catalog')>();
  return {
    ...real,
    matchProductTopN: async (...args: Parameters<typeof real.matchProductTopN>) =>
      nextCandidate.value ? [nextCandidate.value] : real.matchProductTopN(...args),
  };
});

const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let A: Tenant;

const row = (over: Partial<Parameters<typeof commitCatalogRows>[2][number]> = {}) => ({
  supplierSku: null,
  supplierNameRaw: 'שורת מחירון לבדיקה',
  unit: 'ק״ג',
  listPrice: 12.5,
  barcodeEan: null,
  packSize: null,
  ...over,
});

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  nextCandidate.value = null;
});
afterAll(() => resetDb(db));

type Decision = 'auto' | 'review' | 'new';

async function viaCommit(c: LinkCandidate): Promise<Decision> {
  nextCandidate.value = c;
  const res = await commitCatalogRows(db, { restaurantId: A.restaurantId, supplierId: A.supplierId }, [row()], embedder);
  if (res.ambiguous.length > 0) return 'review';
  if (res.createdProducts > 0) return 'new';
  const [item] = await db
    .select({ productId: supplierCatalogItems.productId })
    .from(supplierCatalogItems)
    .where(eq(supplierCatalogItems.supplierNameRaw, row().supplierNameRaw));
  expect(item?.productId).toBe(c.productId);
  return 'auto';
}

async function viaOcr(c: LinkCandidate, inject: boolean): Promise<'auto' | 'not-auto'> {
  const r = await runOcrPipeline('img', {
    documentAi: new StubOcrProvider('document_ai', AGREEMENT_PERFECT.docAi),
    claude: new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude),
    catalogMatcher: async () => [c as Parameters<typeof defaultOcrLinkDecider>[0][number]],
    ...(inject ? { decideLink } : {}),
  });
  return r.reconciled.lines.every((l) => l.productId === c.productId) ? 'auto' : 'not-auto';
}

describe('G-08 parity: import ≡ OCR(injected) ≡ decideLink; OCR default ⊆ decideLink', () => {
  const sets: Array<[string, Omit<LinkCandidate, 'productId' | 'canonicalName'>]> = [
    ['sku exact', { confidence: 0.999, matchedBy: 'sku' }],
    ['human alias', { confidence: 1, matchedBy: 'alias', provenance: 'human' }],
    ['exactKey alias', { confidence: 0.999, matchedBy: 'alias', provenance: 'exactKey' }],
    ['guessed alias 0.9', { confidence: 0.9, matchedBy: 'alias', provenance: 'guess' }],
    ['legacy alias 0.97', { confidence: 0.97, matchedBy: 'alias', provenance: 'legacy' }],
    ['guessed sku 0.9', { confidence: 0.9, matchedBy: 'sku', provenance: 'guess' }],
    ['fuzzy 0.97', { confidence: 0.97, matchedBy: 'fuzzy' }],
    ['embedding 0.95', { confidence: 0.95, matchedBy: 'embedding' }],
    ['fuzzy 0.75', { confidence: 0.75, matchedBy: 'fuzzy' }],
    ['fuzzy 0.4', { confidence: 0.4, matchedBy: 'fuzzy' }],
  ];

  for (const [label, shape] of sets) {
    it(label, async () => {
      const c: LinkCandidate = { productId: A.productId, canonicalName: 'מוצר A', ...shape };
      // Import knows the row's unit fits (ק״ג ↔ ק״ג): unitPack 'match'.
      expect(await viaCommit(c)).toBe(decideLink([c], { unitPack: 'match' }).decision);
      // OCR has no unit: unitPack 'unknown'.
      const ocrPolicy = decideLink([c], { unitPack: 'unknown' }).decision;
      expect(await viaOcr(c, true)).toBe(ocrPolicy === 'auto' ? 'auto' : 'not-auto');
      if ((await viaOcr(c, false)) === 'auto') expect(ocrPolicy).toBe('auto');
    });
  }

  it('the OCR default is a strict subset: it never auto-links a name match', () => {
    for (const [, shape] of sets) {
      const c = { productId: 'p', canonicalName: 'p', ...shape };
      const d = defaultOcrLinkDecider([c], { unitPack: 'unknown' });
      if (d.decision === 'auto') expect(decideLink([c], { unitPack: 'unknown' }).decision).toBe('auto');
    }
  });
});

describe('G-08 golden cases through the real matcher', () => {
  it('פלפל אדום חריף is NOT linked to פלפל אדום: product_id NULL, no alias, 1–3 suggestions', async () => {
    const [pepper] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, canonicalName: 'פלפל אדום', defaultUnit: 'ק״ג' })
      .returning({ id: products.id });
    // The supplier already sells it (the false-leak guard scopes candidates to this).
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      productId: pepper!.id,
      supplierNameRaw: 'פלפל אדום',
      unit: 'ק״ג',
      listPrice: '9.90',
    });

    const res = await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId },
      [row({ supplierNameRaw: 'פלפל אדום חריף' })],
      embedder,
    );

    expect(res.ambiguous).toHaveLength(1);
    const amb = res.ambiguous[0]!;
    expect(amb.canonicalName).toBe('פלפל אדום');
    expect(amb.reasons).toContain('MEDIUM_CONFIDENCE');
    expect(amb.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(amb.suggestions.length).toBeLessThanOrEqual(3);
    expect(amb.suggestions[0]!.productId).toBe(pepper!.id);
    const [item] = await db
      .select({ productId: supplierCatalogItems.productId })
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, amb.itemId));
    expect(item?.productId).toBeNull();
    expect(
      await db.select().from(productAliases).where(eq(productAliases.supplierNameRaw, 'פלפל אדום חריף')),
    ).toEqual([]);
    expect(res.createdProducts).toBe(0);
  });

  it('a unit mismatch at ≥ 0.9 → review, no alias', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'מוצר A', confidence: 0.97, matchedBy: 'embedding' };
    const res = await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId },
      [row({ unit: 'ארגז' })],
      embedder,
    );
    expect(res.ambiguous[0]?.reasons).toEqual(['UNIT_MISMATCH']);
    expect(await db.select().from(productAliases).where(eq(productAliases.supplierNameRaw, row().supplierNameRaw))).toEqual([]);
  });

  it('a fuzzy auto-link learns no confirmed alias; an exact-key link learns one at 0.999', async () => {
    nextCandidate.value = { productId: A.productId, canonicalName: 'מוצר A', confidence: 0.98, matchedBy: 'fuzzy' };
    await commitCatalogRows(db, { restaurantId: A.restaurantId, supplierId: A.supplierId }, [row()], embedder);
    expect(await db.select().from(productAliases).where(eq(productAliases.supplierNameRaw, row().supplierNameRaw))).toEqual([]);

    nextCandidate.value = { productId: A.productId, canonicalName: 'מוצר A', confidence: 0.999, matchedBy: 'sku' };
    await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId },
      [row({ supplierNameRaw: 'שורה עם מק״ט', supplierSku: 'G08-SKU' })],
      embedder,
    );
    const learned = await db
      .select({ confidence: productAliases.confidence })
      .from(productAliases)
      .where(eq(productAliases.supplierNameRaw, 'שורה עם מק״ט'));
    expect(learned).toEqual([{ confidence: '0.999' }]);
  });
});

describe('G-08 identical same-supplier name = exact key (owner decision 31.10)', () => {
  async function namedProduct(supplierId: string, name: string) {
    const [p] = await db
      .insert(products)
      .values({ restaurantId: A.restaurantId, supplierId, canonicalName: name, defaultUnit: 'ק״ג' })
      .returning({ id: products.id });
    await db.insert(supplierCatalogItems).values({
      restaurantId: A.restaurantId,
      supplierId,
      productId: p!.id,
      supplierNameRaw: name,
      unit: 'ק״ג',
    });
    return p!.id;
  }
  const ocrLink = async (supplierId: string, raw: string) => {
    const r = await runOcrPipeline('img', {
      documentAi: new StubOcrProvider('document_ai', AGREEMENT_PERFECT.docAi),
      claude: new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude),
      catalogMatcher: async () => matchProductTopN(db, { restaurantId: A.restaurantId, supplierId, rawDescription: raw }, 3),
      decideLink,
    });
    return r.reconciled.lines[0]?.productId ?? null;
  };

  it('same supplier + same normalized name → auto (import and OCR)', async () => {
    const id = await namedProduct(A.supplierId, 'גבינה צהובה 28%');
    expect(await ocrLink(A.supplierId, 'גבינה  צהובה 28% ')).toBe(id);
    const res = await commitCatalogRows(
      db,
      { restaurantId: A.restaurantId, supplierId: A.supplierId },
      [row({ supplierNameRaw: 'גבינה צהובה 28% ' })],
      embedder,
    );
    expect(res.ambiguous).toEqual([]);
    expect(res.createdProducts).toBe(0);
  });

  it('a different supplier with the same name → not linked', async () => {
    await namedProduct(A.supplierId, 'גבינה צהובה 28%');
    const [other] = await db
      .insert(suppliers)
      .values({ restaurantId: A.restaurantId, name: 'מחלבת אחר' })
      .returning({ id: suppliers.id });
    expect(await ocrLink(other!.id, 'גבינה צהובה 28%')).toBeNull();
  });
});
