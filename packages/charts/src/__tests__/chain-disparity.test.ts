import { describe, expect, it } from 'vitest';
import { computePriceDisparities, type BranchPriceLine, type BranchPriceLines } from '../chain-disparity';

let n = 0;
function line(over: Partial<BranchPriceLine>): BranchPriceLine {
  n += 1;
  const qty = over.qty ?? 10;
  const unitPrice = over.unitPrice ?? 10;
  return {
    invoiceLineId: `l${n}`,
    invoiceId: `i${n}`,
    invoiceNumber: `INV-${n}`,
    invoiceDate: `2026-10-${String((n % 27) + 1).padStart(2, '0')}T08:00:00.000Z`,
    supplierName: 'ירקות השרון',
    supplierNameEn: 'HaSharon Produce',
    supplierBusinessId: '514200101',
    productName: 'עגבניות שרי',
    productNameEn: 'Cherry tomatoes',
    sku: null,
    unit: 'ק״ג',
    lineTotal: Math.round(qty * unitPrice * 100) / 100,
    ...over,
    qty,
    unitPrice,
  };
}
const branch = (id: string, lines: BranchPriceLine[]): BranchPriceLines => ({ restaurantId: id, name: id, lines });

describe('computePriceDisparities', () => {
  it('finds the same product at different prices, with the monthly ₪ impact vs the chain-best price', () => {
    const rows = computePriceDisparities([
      branch('tlv', [line({ unitPrice: 10, qty: 20 })]),
      branch('jlm', [line({ unitPrice: 11.2, qty: 15 }), line({ unitPrice: 11.2, qty: 5 })]),
    ]);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.method).toBe('name');
    expect(r.cheapest.restaurantId).toBe('tlv');
    expect(r.priciest.restaurantId).toBe('jlm');
    expect(r.deltaPct).toBeCloseTo(0.12, 10);
    expect(r.impactIls).toBe(24); // (11.2 − 10) × 20
    expect(r.priciest.impactIls).toBe(24);
    expect(r.cheapest.impactIls).toBe(0);
    expect(r.lines.map((l) => l.restaurantId)).toEqual(['jlm', 'jlm', 'tlv']);
  });

  it('prefers the SKU when both branches carry it, and labels the method', () => {
    const rows = computePriceDisparities([
      branch('a', [line({ sku: 'SH-001', productName: 'שרי', unitPrice: 10 })]),
      branch('b', [line({ sku: 'sh-001 ', productName: 'עגבניות שרי אדומות', unitPrice: 11 })]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.method).toBe('sku');
  });

  it('merges the supplier by business id even when its name is spelled differently', () => {
    const rows = computePriceDisparities([
      branch('a', [line({ supplierName: 'ירקות השרון בע"מ', unitPrice: 10 })]),
      branch('b', [line({ supplierName: 'השרון ירקות', unitPrice: 11 })]),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('is conservative: different supplier, different unit, one branch, small spread or impact → nothing', () => {
    expect(
      computePriceDisparities([
        branch('a', [line({ unitPrice: 10 })]),
        branch('b', [line({ unitPrice: 12, supplierBusinessId: '514999999', supplierName: 'אחר' })]),
      ]),
    ).toEqual([]);
    expect(computePriceDisparities([branch('a', [line({ unitPrice: 10 })]), branch('b', [line({ unitPrice: 12, unit: 'ארגז' })])])).toEqual([]);
    expect(computePriceDisparities([branch('a', [line({ unitPrice: 10 }), line({ unitPrice: 12 })])])).toEqual([]);
    expect(computePriceDisparities([branch('a', [line({ unitPrice: 10 })]), branch('b', [line({ unitPrice: 10.1 })])])).toEqual([]);
    expect(computePriceDisparities([branch('a', [line({ unitPrice: 10, qty: 1 })]), branch('b', [line({ unitPrice: 11, qty: 1 })])])).toEqual([]);
  });

  it('a SKU sold in different units is not compared', () => {
    expect(
      computePriceDisparities([
        branch('a', [line({ sku: 'X1', unit: 'ק״ג', unitPrice: 10 })]),
        branch('b', [line({ sku: 'X1', unit: 'ארגז', unitPrice: 60 })]),
      ]),
    ).toEqual([]);
  });

  it('ranks by ₪ impact and respects the limit', () => {
    const rows = computePriceDisparities(
      [
        branch('a', [line({ unitPrice: 10, qty: 100 }), line({ productName: 'מלפפון', unitPrice: 5, qty: 10 })]),
        branch('b', [line({ unitPrice: 11, qty: 100 }), line({ productName: 'מלפפון', unitPrice: 6, qty: 10 })]),
      ],
      { limit: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.productName).toBe('עגבניות שרי');
    expect(rows[0]!.impactIls).toBe(100);
  });
});
