import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCES, resolveTolerances, runMatch, type MatchInput } from '../index';

/** Invoice with a single line billed 5% above the PO expected price. */
function inputWith(tolerances: MatchInput['tolerances']): MatchInput {
  return {
    invoice: {
      invoiceNumber: 'INV-1',
      invoiceDate: new Date('2026-01-01'),
      supplierId: 's1',
      totalExclVat: 105,
      vatAmount: 17.85,
      totalInclVat: 122.85,
    },
    poLines: [{ id: 'po1', productId: 'p1', qtyOrdered: 10, unit: 'kg', unitPriceExpected: 10 }],
    grLines: [{ id: 'gr1', poLineId: 'po1', productId: 'p1', qtyReceived: 10 }],
    invoiceLines: [
      { id: 'il1', productId: 'p1', qtyBilled: 10, unit: 'kg', unitPriceBilled: 10.5, lineTotal: 105 },
    ],
    vatRate: 0.17,
    tolerances,
  };
}

describe('resolveTolerances', () => {
  it('returns defaults when no overrides', () => {
    expect(resolveTolerances()).toEqual(DEFAULT_TOLERANCES);
    expect(resolveTolerances(null)).toEqual(DEFAULT_TOLERANCES);
  });

  it('merges partial overrides over defaults', () => {
    expect(resolveTolerances({ pricePercent: 0.08 })).toEqual({
      ...DEFAULT_TOLERANCES,
      pricePercent: 0.08,
    });
  });

  it('ignores undefined fields (does not blank out defaults)', () => {
    expect(resolveTolerances({ pricePercent: undefined })).toEqual(DEFAULT_TOLERANCES);
  });
});

describe('per-restaurant tolerances change the decision', () => {
  it('tight tolerances flag a 5% price rise; loose tolerances do not', () => {
    const tight = runMatch(inputWith(resolveTolerances({ pricePercent: 0.02 })));
    const loose = runMatch(inputWith(resolveTolerances({ pricePercent: 0.1 })));

    const tightPrice = tight.discrepancies.filter((d) => d.type === 'PRICE_HIGHER');
    const loosePrice = loose.discrepancies.filter((d) => d.type === 'PRICE_HIGHER');

    expect(tightPrice).toHaveLength(1);
    expect(tightPrice[0]?.severity).toBe('warn');
    expect(loosePrice).toHaveLength(0);
  });
});
