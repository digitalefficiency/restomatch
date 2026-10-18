import { describe, expect, it } from 'vitest';
import {
  reconcileInvoiceToPo,
  type InvoiceLineRef,
  type PoLineRef,
} from '../reconciliation';

function po(overrides: Partial<PoLineRef> = {}): PoLineRef {
  return {
    id: 'po-1',
    productId: 'prod-1',
    qtyOrdered: 10,
    unit: 'ק״ג',
    unitPriceExpected: 8,
    ...overrides,
  };
}

function inv(overrides: Partial<InvoiceLineRef> = {}): InvoiceLineRef {
  return {
    productId: 'prod-1',
    rawDescription: 'עגבניה',
    qtyBilled: 10,
    unit: 'ק״ג',
    unitPriceBilled: 8,
    lineTotal: 80,
    ...overrides,
  };
}

describe('reconcileInvoiceToPo', () => {
  it('exact match yields all lines matched + zero delta', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po()],
      invoiceLines: [inv()],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.status).toBe('matched');
    expect(result.summary.matchedCount).toBe(1);
    expect(result.summary.headlineDelta).toBe(0);
  });

  it('qty difference outside tolerance → qty_diff with delta', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ qtyOrdered: 10 })],
      invoiceLines: [inv({ qtyBilled: 15, lineTotal: 120 })],
    });
    expect(result.lines[0]?.status).toBe('qty_diff');
    expect(result.summary.qtyDiffCount).toBe(1);
    expect(result.lines[0]?.deltaIls).toBeGreaterThan(0);
  });

  it('price difference outside tolerance → price_diff with delta', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ unitPriceExpected: 8 })],
      invoiceLines: [inv({ unitPriceBilled: 10, lineTotal: 100 })],
    });
    expect(result.lines[0]?.status).toBe('price_diff');
    expect(result.summary.priceDiffCount).toBe(1);
    expect(result.lines[0]?.deltaIls).toBe(20); // (10-8) * 10
  });

  it('both qty AND price differ → picks bigger-impact status', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ qtyOrdered: 10, unitPriceExpected: 8 })],
      invoiceLines: [inv({ qtyBilled: 12, unitPriceBilled: 11, lineTotal: 132 })],
    });
    // priceImpact = 3 * 12 = 36; qtyImpact = 2 * 8 = 16 → price_diff wins
    expect(result.lines[0]?.status).toBe('price_diff');
  });

  it('tiny qty diff within absolute tolerance → still matched', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ qtyOrdered: 10 })],
      invoiceLines: [inv({ qtyBilled: 10.5 })], // diff 0.5 < qtyAbsolute=1
    });
    expect(result.lines[0]?.status).toBe('matched');
  });

  it('invoice line with no matching PO product → unordered', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ productId: 'prod-1' })],
      invoiceLines: [
        inv({ productId: 'prod-1' }),
        inv({ productId: 'prod-X', rawDescription: 'נענע', lineTotal: 9 }),
      ],
    });
    expect(result.lines).toHaveLength(2);
    const unordered = result.lines.find((l) => l.status === 'unordered');
    expect(unordered).toBeDefined();
    expect(unordered?.productName).toBe('נענע');
    expect(unordered?.deltaIls).toBe(9);
    expect(result.summary.unorderedCount).toBe(1);
  });

  it('PO line without matching invoice → missing_from_invoice', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ productId: 'prod-1' }), po({ id: 'po-2', productId: 'prod-2' })],
      invoiceLines: [inv({ productId: 'prod-1' })],
    });
    const missing = result.lines.find((l) => l.status === 'missing_from_invoice');
    expect(missing?.poLineId).toBe('po-2');
    expect(result.summary.missingCount).toBe(1);
  });

  it('productMatches override (human review) used instead of OCR-supplied productId', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ productId: 'prod-tomato' })],
      invoiceLines: [inv({ productId: null, rawDescription: 'עגבניה' })],
      productMatches: new Map([[0, 'prod-tomato']]),
    });
    expect(result.lines[0]?.status).toBe('matched');
    expect(result.summary.matchedCount).toBe(1);
  });

  it('productNames used for display name', () => {
    const result = reconcileInvoiceToPo({
      poLines: [po({ productId: 'prod-tomato' })],
      invoiceLines: [inv({ productId: 'prod-tomato' })],
      productNames: new Map([['prod-tomato', 'עגבניה שרי premium']]),
    });
    expect(result.lines[0]?.productName).toBe('עגבניה שרי premium');
  });

  it('empty inputs → empty result', () => {
    const result = reconcileInvoiceToPo({ poLines: [], invoiceLines: [] });
    expect(result.lines).toEqual([]);
    expect(result.summary.matchedCount).toBe(0);
    expect(result.summary.overallConfidence).toBe(0);
  });

  it('overallConfidence reflects matched ratio', () => {
    const result = reconcileInvoiceToPo({
      poLines: [
        po({ productId: 'prod-1' }),
        po({ id: 'po-2', productId: 'prod-2' }),
      ],
      invoiceLines: [
        inv({ productId: 'prod-1' }), // matched
        inv({ productId: 'prod-2', qtyBilled: 99, lineTotal: 792 }), // qty_diff
      ],
    });
    // 1 matched / 2 total = 0.5
    expect(result.summary.overallConfidence).toBe(0.5);
  });

  it('custom tolerances tighten the matched band', () => {
    const tight = reconcileInvoiceToPo({
      poLines: [po()],
      invoiceLines: [inv({ unitPriceBilled: 8.1 })], // 1.25% diff
      tolerances: { pricePercent: 0.005, priceAbsolute: 0.05 }, // very tight
    });
    expect(tight.lines[0]?.status).toBe('price_diff');

    const loose = reconcileInvoiceToPo({
      poLines: [po()],
      invoiceLines: [inv({ unitPriceBilled: 8.1 })],
    });
    expect(loose.lines[0]?.status).toBe('matched'); // default tolerance allows it
  });

  it('headlineDelta is sum of all line deltas', () => {
    const result = reconcileInvoiceToPo({
      poLines: [
        po({ productId: 'prod-1', qtyOrdered: 10, unitPriceExpected: 8 }),
        po({ id: 'po-2', productId: 'prod-2', qtyOrdered: 5, unitPriceExpected: 6 }),
      ],
      invoiceLines: [
        inv({ productId: 'prod-1', qtyBilled: 10, unitPriceBilled: 10, lineTotal: 100 }), // +20
        inv({ productId: 'prod-2', qtyBilled: 5, unitPriceBilled: 6, lineTotal: 30 }), // matched
      ],
    });
    expect(result.summary.headlineDelta).toBe(20);
  });
});
