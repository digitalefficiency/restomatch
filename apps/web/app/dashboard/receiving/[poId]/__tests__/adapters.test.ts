import { describe, expect, it } from 'vitest';
import { adaptReconciliation, type InvoiceLineRow, type PoLineRow } from '../_adapters';

/** EN-5: the receiving review is calm — no false "missing" / "not ordered" alarms. */
const po = { id: 'po', supplierId: 's', supplierName: 'ספק', expectedAt: null, status: 'sent', totalEstimated: null };
const poLines: PoLineRow[] = [
  { id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '4', unit: 'ק״ג', unitPriceExpected: '20' },
  { id: 'pl2', productId: 'p2', rawDescription: 'עגבניה שרי', qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' },
];
const inv = (o: Partial<InvoiceLineRow>): InvoiceLineRow => ({
  id: o.id ?? 'i',
  productId: null,
  rawDescription: null,
  qtyBilled: '1',
  unit: 'ק״ג',
  unitPriceBilled: '1',
  lineTotal: '1',
  ...o,
});

describe('adaptReconciliation — calm statuses (EN-5)', () => {
  it('PO-only (no invoice / OCR failed): every line is pending review, never missing, no ₪', () => {
    const { result } = adaptReconciliation({ po, poLines, receiptLines: [], invoiceLines: [] });
    expect(result.lines.map((l) => l.status)).toEqual(['pending_review', 'pending_review']);
    expect(result.summary.missingCount).toBe(0);
    expect(result.summary.pendingCount).toBe(2);
    expect(result.summary.headlineDelta).toBe(0);
  });

  it('OCR lines not linked to a product are pending review (no "not ordered", no loss)', () => {
    const { result } = adaptReconciliation({
      po,
      poLines,
      receiptLines: [],
      invoiceLines: [inv({ id: 'a', rawDescription: 'פרגית טרייה', qtyBilled: '5', unitPriceBilled: '30' })],
    });
    expect(result.summary.unorderedCount).toBe(0);
    expect(result.summary.missingCount).toBe(0);
    expect(result.summary.headlineDelta).toBe(0);
    expect(result.lines.every((l) => l.status === 'pending_review')).toBe(true);
  });

  it('pairs by normalized description (gershayim / spacing) when not product-linked', () => {
    const { result } = adaptReconciliation({
      po,
      poLines,
      receiptLines: [],
      invoiceLines: [
        inv({ id: 'a', rawDescription: 'חזה  עוף', qtyBilled: '4', unitPriceBilled: '21.6' }),
        inv({ id: 'b', productId: 'p2', rawDescription: 'עגבניה שרי', qtyBilled: '2', unitPriceBilled: '10' }),
      ],
    });
    expect(result.lines.map((l) => l.status)).toEqual(['price_diff', 'matched']);
    expect(result.summary.headlineDelta).toBeCloseTo(6.4, 2);
  });

  it('a conclusive comparison still flags real discrepancies', () => {
    const { result } = adaptReconciliation({
      po,
      poLines,
      receiptLines: [],
      invoiceLines: [
        inv({ id: 'a', productId: 'p1', qtyBilled: '4', unitPriceBilled: '20' }),
        inv({ id: 'x', productId: 'p9', rawDescription: 'שמן', qtyBilled: '1', unitPriceBilled: '50' }),
      ],
    });
    // pl2 is genuinely absent from a fully-linked invoice; p9 is a known product not ordered.
    expect(result.lines.map((l) => l.status)).toEqual(['matched', 'missing_from_invoice', 'unordered']);
    expect(result.summary.headlineDelta).toBe(50);
  });

  it('one invoice line never pairs with two PO lines', () => {
    const { result } = adaptReconciliation({
      po,
      poLines: [poLines[0]!, { ...poLines[0]!, id: 'pl1b' }],
      receiptLines: [],
      invoiceLines: [inv({ id: 'a', productId: 'p1', qtyBilled: '4', unitPriceBilled: '20' })],
    });
    expect(result.lines.filter((l) => l.invoiceLineIndex !== null)).toHaveLength(1);
  });
});
