import { describe, expect, it } from 'vitest';
import { expectedQtyForLine } from '../supplierConfirm/expectation';

const line = { id: 'l1', qtyOrdered: '10.000' };
const entry = (qtyAvailable: number | null, proposedUnitPrice: number | null = null, poLineId = 'l1') => ({
  poLineId,
  qtyAvailable,
  proposedUnitPrice,
});

describe('expectedQtyForLine (G-10 → W2-05, H-08)', () => {
  it('no answer → the ordered quantity, source "ordered"', () => {
    expect(expectedQtyForLine(line, null)).toEqual({ qty: 10, source: 'ordered' });
    expect(expectedQtyForLine({ id: 'l1', qtyOrdered: 7.5 }, null)).toEqual({ qty: 7.5, source: 'ordered' });
  });

  it("the supplier's 6 beats the ordered 10", () => {
    expect(expectedQtyForLine(line, { lines: [entry(6)] })).toEqual({ qty: 6, source: 'supplier' });
  });

  it("the supplier's 0 (out of stock) stays 0", () => {
    expect(expectedQtyForLine(line, { lines: [entry(0)] })).toEqual({ qty: 0, source: 'supplier' });
  });

  it('(a) more than ordered → the dock expects what was ordered; the supplier\'s number stays visible', () => {
    expect(expectedQtyForLine(line, { lines: [entry(12)] })).toEqual({ qty: 10, source: 'supplier_more', supplierQty: 12 });
  });

  it('(b) answered, and this line has no entry or only a price entry → "confirmed" at the ordered qty', () => {
    expect(expectedQtyForLine(line, { lines: [] })).toEqual({ qty: 10, source: 'confirmed' });
    expect(expectedQtyForLine(line, { lines: [entry(3, null, 'other')] })).toEqual({ qty: 10, source: 'confirmed' });
    expect(expectedQtyForLine(line, { lines: [entry(null, 9)] })).toEqual({ qty: 10, source: 'confirmed' });
  });

  it('(c) a shortage written only in the note is not part of the expectation', () => {
    const answer = { lines: [], note: 'רק 6 עגבניות, השאר מחר' };
    expect(expectedQtyForLine(line, answer)).toEqual({ qty: 10, source: 'confirmed' });
  });
});
