import { describe, expect, it } from 'vitest';
import { areConvertible, runMatch, unitConversionFactor, type MatchInput } from '../index';

describe('unitConversionFactor', () => {
  it('converts within a dimension', () => {
    expect(unitConversionFactor('g', 'kg')).toBeCloseTo(0.001, 6);
    expect(unitConversionFactor('kg', 'g')).toBeCloseTo(1000, 6);
    expect(unitConversionFactor('l', 'ml')).toBeCloseTo(1000, 6);
    expect(unitConversionFactor('ק"ג', 'גרם')).toBeCloseTo(1000, 6);
  });

  it('returns null across dimensions or unknown units', () => {
    expect(unitConversionFactor('kg', 'l')).toBeNull();
    expect(unitConversionFactor('ארגז', 'יחידה')).toBeNull();
    expect(areConvertible('box', 'unit')).toBe(false);
  });
});

function inputWith(
  poUnit: string,
  invUnit: string,
  poPrice: number,
  invPrice: number,
  invQty: number,
): MatchInput {
  const lineTotal = invPrice * invQty;
  return {
    invoice: {
      invoiceNumber: 'INV',
      invoiceDate: new Date('2026-01-01'),
      supplierId: 's',
      totalExclVat: lineTotal,
      vatAmount: lineTotal * 0.17,
      totalInclVat: lineTotal * 1.17,
    },
    poLines: [{ id: 'po', productId: 'p', qtyOrdered: 10, unit: poUnit, unitPriceExpected: poPrice }],
    grLines: [{ id: 'gr', poLineId: 'po', productId: 'p', qtyReceived: 10 }],
    invoiceLines: [
      { id: 'il', productId: 'p', qtyBilled: invQty, unit: invUnit, unitPriceBilled: invPrice, lineTotal },
    ],
    vatRate: 0.17,
    tolerances: { pricePercent: 0.02, priceAbsolute: 5, qtyPercent: 0.03, qtyAbsolute: 1, blockPricePercent: 0.1 },
  };
}

describe('runMatch unit normalization', () => {
  it('kg PO vs g invoice: no UNIT_MISMATCH, price reconciles cleanly', () => {
    // PO: 10 kg @ ₪10/kg. Invoice: 10000 g @ ₪0.01/g (≡ ₪10/kg, 10 kg).
    const r = runMatch(inputWith('kg', 'g', 10, 0.01, 10000));
    expect(r.discrepancies.find((d) => d.type === 'UNIT_MISMATCH')).toBeUndefined();
    expect(r.discrepancies.filter((d) => d.type.startsWith('PRICE'))).toHaveLength(0);
  });

  it('non-convertible units still flag UNIT_MISMATCH', () => {
    const r = runMatch(inputWith('ארגז', 'יחידה', 10, 10, 10));
    expect(r.discrepancies.find((d) => d.type === 'UNIT_MISMATCH')).toBeDefined();
  });
});
