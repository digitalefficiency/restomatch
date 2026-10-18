import { describe, expect, it } from 'vitest';
import { adaptReconciliation, keepAdjusted, type InvoiceLineRow, type PoLineRow } from '../_adapters';

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

describe('adaptReconciliation — refuter cases (EN-5)', () => {
  it('one ordered item billed on two invoice lines is folded: matched, no gap, no "not ordered"', () => {
    const { result } = adaptReconciliation({
      po,
      poLines: [{ id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '25' }],
      receiptLines: [],
      invoiceLines: [
        inv({ id: 'a', productId: 'p1', qtyBilled: '5', unitPriceBilled: '25', lineTotal: '125' }),
        inv({ id: 'b', productId: 'p1', qtyBilled: '5', unitPriceBilled: '25', lineTotal: '125' }),
      ],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ status: 'matched', invoiceQty: 10, deltaIls: 0 });
    expect(result.summary.unorderedCount).toBe(0);
    expect(result.summary.headlineDelta).toBe(0);
  });

  it('a real split shortfall still shows the true gap once', () => {
    const { result } = adaptReconciliation({
      po,
      poLines: [{ id: 'pl1', productId: 'p1', rawDescription: 'חזה עוף', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '25' }],
      receiptLines: [],
      invoiceLines: [
        inv({ id: 'a', productId: 'p1', qtyBilled: '5', unitPriceBilled: '25', lineTotal: '125' }),
        inv({ id: 'b', productId: 'p1', qtyBilled: '3', unitPriceBilled: '25', lineTotal: '75' }),
      ],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ status: 'qty_diff', invoiceQty: 8, deltaIls: 50 });
    expect(result.summary.headlineDelta).toBe(50);
  });

  it('an unreadable (zero-filled) invoice line is "check by hand", never a ₪ gap', () => {
    const { result } = adaptReconciliation({
      po,
      poLines: [{ id: 'pl1', productId: 'p1', rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'ק״ג', unitPriceExpected: '25' }],
      receiptLines: [],
      invoiceLines: [
        inv({ id: 'a', productId: 'p1', qtyBilled: '0', unitPriceBilled: '25', lineTotal: '0' }),
        inv({ id: 'b', productId: 'p9', qtyBilled: '2', unitPriceBilled: '0', lineTotal: '0' }),
      ],
    });
    expect(result.lines.map((l) => l.status)).toEqual(['pending_review', 'pending_review']);
    expect(result.summary.headlineDelta).toBe(0);
  });
});

describe('keepAdjusted (EN-4: "Show results" never discards what the receiver counted)', () => {
  it('keeps hand-adjusted lines, refreshes the rest', () => {
    const mark = (q: number, touched = false) => ({
      poLineId: 'pl', invoiceLineIndex: 0, productId: null, productName: 'x',
      qtyReceived: q, qtyRejected: 0, condition: 'ok' as const, touched,
    });
    const prev = { a: { ...mark(3, true), qtyRejected: 1, condition: 'rejected' as const }, b: mark(9, true) };
    const next = { a: mark(10), b: mark(5), c: mark(1) };
    const out = keepAdjusted(prev, next, new Set(['a', 'gone']));
    expect(out.a).toMatchObject({ qtyReceived: 3, qtyRejected: 1, condition: 'rejected', touched: true });
    expect(out.b!.qtyReceived).toBe(5); // auto-touched only — takes the new invoice default
    expect(out.c!.qtyReceived).toBe(1);
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c']);
  });
});
