/**
 * End-to-end test of the receiving flow:
 *   manual PO → start receipt → mark lines → submit → OCR (mocked) → match
 *
 * Uses real DB + real catalog matcher + real matching engine.
 * OCR providers are stubs returning a hand-crafted fixture.
 */
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { matchProductTopN } from '@restomatch/catalog';
import {
  createDb,
  discrepancies,
  goodsReceipts,
  grLines,
  invoiceLines,
  invoices,
  matchRuns,
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
import { runMatch, type MatchInput } from '@restomatch/matching';
import { runOcrPipeline, StubOcrProvider } from '@restomatch/ocr';
import type { InvoiceOcrResult } from '@restomatch/types';
import { appRouter } from '../index';
import type { AppContext } from '../context';

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

async function resetDb() {
  await db.delete(discrepancies);
  await db.delete(matchRuns);
  await db.delete(invoiceLines);
  await db.delete(invoices);
  await db.delete(grLines);
  await db.delete(goodsReceipts);
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

beforeEach(resetDb);
afterAll(resetDb);

describe('E2E — full receiving flow', () => {
  it('PO → GR → OCR → matching engine produces blocked status on overcharge', async () => {
    // ── Seed restaurant + receiver
    const [restaurant] = await db.insert(restaurants).values({ name: 'E2E Bistro' }).returning();
    const [receiver] = await db
      .insert(users)
      .values({ email: 'receiver@e2e.test', name: 'Yossi' })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: receiver!.id, restaurantId: restaurant!.id, role: 'receiver' });

    // ── Supplier + products
    const [supplier] = await db
      .insert(suppliers)
      .values({ restaurantId: restaurant!.id, name: 'ירקני אבי' })
      .returning();
    const [tomatoProduct] = await db
      .insert(products)
      .values({
        restaurantId: restaurant!.id,
        canonicalName: 'עגבניה שרי',
        defaultUnit: 'ק״ג',
        // Link the product to the supplier so the supplier-scoped catalog matcher
        // (supplierScopeSql: false-leak guard — only products this supplier sells)
        // considers it as a fuzzy candidate. Without this the matcher correctly
        // returns 0 candidates for an unlinked product.
        supplierId: supplier!.id,
      })
      .returning();

    // ── PO scheduled for today
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId: restaurant!.id,
        supplierId: supplier!.id,
        expectedDeliveryAt: today,
        status: 'sent',
        source: 'manual',
      })
      .returning();
    await db.insert(poLines).values({
      poId: po!.id,
      productId: tomatoProduct!.id,
      rawDescription: 'עגבניה שרי',
      qtyOrdered: '10',
      unit: 'ק״ג',
      unitPriceExpected: '8',
    });

    // ── Caller as receiver
    const ctx: AppContext = {
      db,
      session: { userId: receiver!.id, restaurantId: restaurant!.id, role: 'receiver' },
    };
    const caller = appRouter.createCaller(ctx);

    // 1. Receiver checks today's list
    const list = await caller.receiving.todayExpectations();
    expect(list).toHaveLength(1);
    expect(list[0]?.poId).toBe(po!.id);

    // 2. Receiver starts receipt
    const { receiptId } = await caller.receiving.startReceipt({ poId: po!.id });
    expect(receiptId).toBeTruthy();

    // 3. Receiver marks line as fully received (10 ק״ג)
    const allGr = await db.select().from(grLines);
    const grLine = allGr.find((l) => l.grId === receiptId)!;
    await caller.receiving.markGrLine({ grLineId: grLine.id, qtyReceived: 10 });

    // 4. Receiver submits receipt
    const submitted = await caller.receiving.submitReceipt({ grId: receiptId });
    expect(submitted.status).toBe('completed');

    // 5. Receiver registers invoice (image uploaded)
    const { invoiceId } = await caller.receiving.registerInvoice({
      grId: receiptId,
      imageUrl: 'https://example.com/inv.jpg',
      supplierId: supplier!.id,
    });

    // 6. Simulate OCR pipeline (worker would do this in production)
    const docAi: InvoiceOcrResult = {
      supplier: { name: 'ירקני אבי' },
      invoiceNumber: 'INV-E2E-1',
      invoiceDate: today.toISOString(),
      lines: [
        {
          rawDescription: 'עגבניה שרי',
          qty: 10,
          unit: 'ק״ג',
          unitPrice: 12, // 50% above expected — should trigger BLOCK
          lineTotal: 120,
        },
      ],
      totals: { subtotal: 120, vat: 20.4, total: 140.4 },
    };
    const ocrResult = await runOcrPipeline('image-fixture', {
      documentAi: new StubOcrProvider('document_ai', docAi),
      claude: new StubOcrProvider('claude_vision', docAi),
      catalogMatcher: async (line) => {
        const candidates = await matchProductTopN(
          db,
          {
            restaurantId: restaurant!.id,
            supplierId: supplier!.id,
            rawDescription: line.rawDescription,
          },
          3,
          { embeddingMinSimilarity: 0.85, fuzzyMinSimilarity: 0.3 },
        );
        return candidates.map((c) => ({
          productId: c.productId,
          canonicalName: c.canonicalName,
          confidence: c.confidence,
          matchedBy: c.matchedBy,
        }));
      },
    });

    expect(ocrResult.reconciled.lines).toHaveLength(1);
    expect(ocrResult.reconciled.lines[0]?.productCandidates.length).toBeGreaterThan(0);
    // High fuzzy match auto-links the product
    const linkedProductId = ocrResult.reconciled.lines[0]?.productId;

    // Persist invoice + lines (worker does this; we do it inline for the test)
    const reconciledLine = ocrResult.reconciled.lines[0]!;
    await db.insert(invoiceLines).values({
      invoiceId,
      productId: linkedProductId,
      rawDescription: reconciledLine.rawDescription,
      qtyBilled: reconciledLine.qty.toString(),
      unit: reconciledLine.unit,
      unitPriceBilled: reconciledLine.unitPrice.toString(),
      lineTotal: reconciledLine.lineTotal.toString(),
    });

    // 7. Run matching engine over PO + GR + invoice
    const poLinesRows = await db.select().from(poLines);
    const grLinesRows = await db.select().from(grLines);
    const invoiceLinesRows = await db.select().from(invoiceLines);

    const matchInput: MatchInput = {
      invoice: {
        invoiceNumber: 'INV-E2E-1',
        invoiceDate: today,
        supplierId: supplier!.id,
        totalExclVat: 120,
        vatAmount: 20.4,
        totalInclVat: 140.4,
      },
      poLines: poLinesRows.map((p) => ({
        id: p.id,
        productId: p.productId,
        qtyOrdered: Number(p.qtyOrdered),
        unit: p.unit,
        unitPriceExpected: p.unitPriceExpected ? Number(p.unitPriceExpected) : null,
      })),
      grLines: grLinesRows.map((g) => ({
        id: g.id,
        poLineId: g.poLineId,
        productId: g.productId,
        qtyReceived: Number(g.qtyReceived),
      })),
      invoiceLines: invoiceLinesRows.map((i) => ({
        id: i.id,
        productId: i.productId,
        qtyBilled: Number(i.qtyBilled),
        unit: i.unit,
        unitPriceBilled: Number(i.unitPriceBilled),
        lineTotal: Number(i.lineTotal),
      })),
      vatRate: 0.17,
      tolerances: {
        pricePercent: 0.02,
        priceAbsolute: 5,
        qtyPercent: 0.03,
        qtyAbsolute: 1,
        blockPricePercent: 0.1,
      },
    };
    const matchResult = runMatch(matchInput);

    expect(matchResult.status).toBe('blocked');
    const priceDiscrepancies = matchResult.discrepancies.filter(
      (d) => d.type === 'PRICE_HIGHER',
    );
    expect(priceDiscrepancies).toHaveLength(1);
    expect(priceDiscrepancies[0]?.severity).toBe('block');
    expect(matchResult.totalDiscrepancyAmount).toBeGreaterThanOrEqual(40);
  });

  it('clean flow → completed receipt + clean match', async () => {
    // ── Setup similar to above
    const [restaurant] = await db.insert(restaurants).values({ name: 'E2E Bistro 2' }).returning();
    const [receiver] = await db
      .insert(users)
      .values({ email: 'receiver2@e2e.test' })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: receiver!.id, restaurantId: restaurant!.id, role: 'receiver' });
    const [supplier] = await db
      .insert(suppliers)
      .values({ restaurantId: restaurant!.id, name: 'ירקני אבי' })
      .returning();
    const [tomatoProduct2] = await db
      .insert(products)
      .values({
        restaurantId: restaurant!.id,
        canonicalName: 'עגבניה שרי',
        defaultUnit: 'ק״ג',
      })
      .returning();
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    const [po] = await db
      .insert(purchaseOrders)
      .values({
        restaurantId: restaurant!.id,
        supplierId: supplier!.id,
        expectedDeliveryAt: today,
        status: 'sent',
        source: 'manual',
      })
      .returning();
    await db.insert(poLines).values({
      poId: po!.id,
      productId: tomatoProduct2!.id,
      rawDescription: 'עגבניה שרי',
      qtyOrdered: '10',
      unit: 'ק״ג',
      unitPriceExpected: '8',
    });

    const ctx: AppContext = {
      db,
      session: { userId: receiver!.id, restaurantId: restaurant!.id, role: 'receiver' },
    };
    const caller = appRouter.createCaller(ctx);

    const { receiptId } = await caller.receiving.startReceipt({ poId: po!.id });
    const allGr = await db.select().from(grLines);
    const myLine = allGr.find((l) => l.grId === receiptId)!;
    await caller.receiving.markGrLine({ grLineId: myLine.id, qtyReceived: 10 });
    const submitted = await caller.receiving.submitReceipt({ grId: receiptId });
    expect(submitted.status).toBe('completed');

    // Clean invoice (matches PO exactly)
    const poLinesRows = await db.select().from(poLines);
    const grLinesRows = await db.select().from(grLines);
    const matchInput: MatchInput = {
      invoice: {
        invoiceNumber: 'INV-E2E-2',
        invoiceDate: today,
        supplierId: supplier!.id,
        totalExclVat: 80,
        vatAmount: 13.6,
        totalInclVat: 93.6,
      },
      poLines: poLinesRows.map((p) => ({
        id: p.id,
        productId: p.productId,
        qtyOrdered: Number(p.qtyOrdered),
        unit: p.unit,
        unitPriceExpected: p.unitPriceExpected ? Number(p.unitPriceExpected) : null,
      })),
      grLines: grLinesRows.map((g) => ({
        id: g.id,
        poLineId: g.poLineId,
        productId: g.productId,
        qtyReceived: Number(g.qtyReceived),
      })),
      invoiceLines: [
        {
          id: 'inv-line-1',
          productId: poLinesRows[0]!.productId,
          qtyBilled: 10,
          unit: 'ק״ג',
          unitPriceBilled: 8,
          lineTotal: 80,
        },
      ],
      vatRate: 0.17,
      tolerances: {
        pricePercent: 0.02,
        priceAbsolute: 5,
        qtyPercent: 0.03,
        qtyAbsolute: 1,
        blockPricePercent: 0.1,
      },
    };
    const matchResult = runMatch(matchInput);
    expect(matchResult.status).toBe('clean');
    expect(matchResult.discrepancies).toEqual([]);
  });
});
