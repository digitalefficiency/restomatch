import { describe, expect, it } from 'vitest';
import { planBackorder, type BackorderLineInput } from '../orders/backorder';

/**
 * W3-09 / AU-11 b · the billed-not-received guard: never re-order units the
 * supplier billed (they belong to a credit request), always re-order units it
 * did not bill.
 */
const line = (id: string, ordered: number, received: number, billed: number | null): BackorderLineInput => ({
  poLineId: id,
  productId: `p-${id}`,
  description: `מוצר ${id}`,
  unit: 'ק״ג',
  qtyOrdered: ordered,
  qtyReceived: received,
  qtyBilled: billed,
});

describe('planBackorder', () => {
  it('no invoice yet: ordered − received, flagged for a human check', () => {
    const p = planBackorder([line('a', 10, 8, null), line('b', 5, 0, null), line('c', 3, 3, null)]);
    expect(p.lines.map((l) => [l.poLineId, l.qty])).toEqual([
      ['a', 2],
      ['b', 5],
    ]);
    expect(p.invoiceNotMatched).toBe(true);
    expect(p.notes).toEqual([]);
  });

  it('missing units billed in full (engine QTY_OVER, QTY_SHORT ₪0) → excluded and noted', () => {
    const p = planBackorder([line('a', 10, 8, 10)]);
    expect(p.lines).toEqual([]);
    expect(p.notes).toEqual([{ poLineId: 'a', description: 'מוצר a', kind: 'billed_in_full' }]);
    expect(p.invoiceNotMatched).toBe(false);
  });

  it('billed for half the missing units → re-order ordered − billed, noted', () => {
    const p = planBackorder([line('a', 10, 6, 8)]);
    expect(p.lines.map((l) => l.qty)).toEqual([2]);
    expect(p.notes[0]!.kind).toBe('billed_in_part');
  });

  it('QTY_SHORT ₪ > 0 (supplier billed only what arrived) → included in full', () => {
    const p = planBackorder([line('a', 10, 7, 7)]);
    expect(p.lines.map((l) => l.qty)).toEqual([3]);
    expect(p.notes).toEqual([]);
  });

  it('nothing short → empty plan', () => {
    expect(planBackorder([line('a', 4, 4, 4), line('b', 2, 3, 3)])).toEqual({ lines: [], notes: [], invoiceNotMatched: false });
  });

  it('fractional kilos round to 3 dp', () => {
    expect(planBackorder([line('a', 2.5, 2.1, null)]).lines[0]!.qty).toBe(0.4);
  });
});
