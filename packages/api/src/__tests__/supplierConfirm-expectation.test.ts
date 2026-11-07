import { describe, expect, it } from 'vitest';
import { expectedQtyForLine } from '../supplierConfirm/expectation';

const line = { id: 'l1', qtyOrdered: '10.000' };

describe('expectedQtyForLine (G-10 → W2-05, H-08)', () => {
  it('no answer → the ordered quantity', () => {
    expect(expectedQtyForLine(line, null)).toEqual({ qty: 10, source: 'ordered' });
    expect(expectedQtyForLine({ id: 'l1', qtyOrdered: 7.5 }, null)).toEqual({ qty: 7.5, source: 'ordered' });
  });

  it("the supplier's 6 beats the ordered 10", () => {
    expect(expectedQtyForLine(line, { lines: [{ poLineId: 'l1', qtyAvailable: 6, proposedUnitPrice: null }] })).toEqual({
      qty: 6,
      source: 'supplier',
    });
  });

  it('the supplier\'s 0 (out of stock) stays 0', () => {
    expect(expectedQtyForLine(line, { lines: [{ poLineId: 'l1', qtyAvailable: 0, proposedUnitPrice: null }] })).toEqual({
      qty: 0,
      source: 'supplier',
    });
  });

  it('an answer with no entry for this line, or a price-only entry → ordered', () => {
    expect(expectedQtyForLine(line, { lines: [] })).toEqual({ qty: 10, source: 'ordered' });
    expect(expectedQtyForLine(line, { lines: [{ poLineId: 'other', qtyAvailable: 3, proposedUnitPrice: null }] })).toEqual({
      qty: 10,
      source: 'ordered',
    });
    expect(expectedQtyForLine(line, { lines: [{ poLineId: 'l1', qtyAvailable: null, proposedUnitPrice: 9 }] })).toEqual({
      qty: 10,
      source: 'ordered',
    });
  });
});
