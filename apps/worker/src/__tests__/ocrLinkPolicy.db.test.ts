import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, products, restaurants, supplierCatalogItems, suppliers, testDbUrl } from '@restomatch/db';
import { decideLink, MockEmbeddingProvider } from '@restomatch/catalog';
import { runOcrPipeline, StubOcrProvider } from '@restomatch/ocr';
import type { InvoiceOcrResult } from '@restomatch/types';
import { ocrCatalogMatcher } from '../jobs/ocrInvoice';

/**
 * G-08 (review HIGH-2): the worker's OCR path carries the matcher's provenance
 * and injects decideLink, so an IDENTICAL normalized name of the SAME supplier
 * links (owner decision 31.10) — and a merely similar name stays a question.
 */
const db = createDb(testDbUrl());
const embedder = new MockEmbeddingProvider(1536);
let restaurantId = '';
let supplierId = '';
let otherSupplierId = '';
let productId = '';

async function cleanup() {
  if (!restaurantId) return;
  await db.delete(supplierCatalogItems).where(eq(supplierCatalogItems.restaurantId, restaurantId));
  await db.delete(products).where(eq(products.restaurantId, restaurantId));
  await db.delete(suppliers).where(eq(suppliers.restaurantId, restaurantId));
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
}

beforeEach(async () => {
  await cleanup();
  const [r] = await db.insert(restaurants).values({ name: 'G-08 OCR link' }).returning();
  restaurantId = r!.id;
  const [s, o] = await db
    .insert(suppliers)
    .values([
      { restaurantId, name: 'מחלבה' },
      { restaurantId, name: 'מחלבה אחרת' },
    ])
    .returning();
  supplierId = s!.id;
  otherSupplierId = o!.id;
  const [p] = await db
    .insert(products)
    .values({ restaurantId, supplierId, canonicalName: 'גבינה צהובה 28%', defaultUnit: 'ק״ג' })
    .returning();
  productId = p!.id;
  await db.insert(supplierCatalogItems).values({ restaurantId, supplierId, productId, supplierNameRaw: 'גבינה צהובה 28%' });
});
afterAll(cleanup);

function invoiceWith(raw: string): InvoiceOcrResult {
  return {
    supplier: { name: 'מחלבה' },
    invoiceNumber: 'G08-1',
    invoiceDate: '2026-10-31',
    lines: [{ rawDescription: raw, qty: 2, unit: 'ק״ג', unitPrice: 40, lineTotal: 80 }],
    totals: { subtotal: 80, vat: 14.4, total: 94.4 },
  } as InvoiceOcrResult;
}

async function ocr(raw: string, forSupplier = supplierId) {
  const stub = new StubOcrProvider('claude_vision', invoiceWith(raw));
  return runOcrPipeline('img', {
    documentAi: stub,
    claude: stub,
    catalogMatcher: ocrCatalogMatcher(db, restaurantId, forSupplier, embedder),
    decideLink,
  });
}

describe('worker OCR link policy (HIGH-2)', () => {
  it('an identical normalized same-supplier name links (spacing / NBSP differences included)', async () => {
    for (const raw of ['גבינה צהובה 28%', '  גבינה צהובה   28% ']) {
      const r = await ocr(raw);
      expect(r.reconciled.lines[0]?.productId).toBe(productId);
      expect(r.reviewReasons).not.toContain('unlinked');
    }
  });

  it('the matcher carries provenance (exactKey) through the worker mapping', async () => {
    const cands = await ocrCatalogMatcher(db, restaurantId, supplierId, embedder)({
      rawDescription: 'גבינה צהובה 28%',
      qty: 1,
      unit: 'ק״ג',
      unitPrice: 1,
      lineTotal: 1,
    });
    expect(cands[0]).toMatchObject({ productId, provenance: 'exactKey' });
  });

  it('a similar name stays a question (held), and another supplier never links', async () => {
    const similar = await ocr('גבינה צהובה 9%');
    expect(similar.reconciled.lines[0]?.productId).toBeNull();
    expect(similar.reviewReasons).toContain('unlinked');
    const other = await ocr('גבינה צהובה 28%', otherSupplierId);
    expect(other.reconciled.lines[0]?.productId).toBeNull();
  });
});
