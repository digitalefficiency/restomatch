import { describe, expect, it } from 'vitest';
import { buildImportDiff, type CurrentCatalogRow } from '../catalog/importDiff';
import { divRoundHalfAway, priceUnitsTimesQtyToAgorot } from '../catalog/rounding';

const cur = (o: Partial<CurrentCatalogRow> & { id: string; name: string }): CurrentCatalogRow => ({
  supplierSku: null,
  priceUnits: null,
  monthlyQty: 0,
  active: true,
  ...o,
});

describe('W3-10 rounding', () => {
  it('rounds half away from zero, symmetric for rises and falls', () => {
    expect(divRoundHalfAway(5n, 10n)).toBe(1n);
    expect(divRoundHalfAway(-5n, 10n)).toBe(-1n);
    expect(divRoundHalfAway(4n, 10n)).toBe(0n);
    expect(priceUnitsTimesQtyToAgorot(50, 1)).toBe(1); // ₪0.005 × 1 → 1 agora
    expect(priceUnitsTimesQtyToAgorot(-50, 1)).toBe(-1);
  });
  it('is exact for large price × fractional qty', () => {
    // ₪12,345.6789 × 1,234.567 kg = ₪15,241,567.7625363 → 1,524,156,776 agorot (Decimal-checked)
    expect(priceUnitsTimesQtyToAgorot(123456789, 1234.567)).toBe(1524156776);
  });
});

describe('W3-10 buildImportDiff ("מה ישתנה")', () => {
  const current = [
    cur({ id: 'a', supplierSku: 'T-1', name: 'עגבניה', priceUnits: 50000, monthlyQty: 120 }), // ₪5.00 ×120
    cur({ id: 'b', supplierSku: 'C-2', name: 'מלפפון', priceUnits: 40000, monthlyQty: 80 }),
    cur({ id: 'c', name: 'בצל יבש', priceUnits: 30000, monthlyQty: 10.5 }),
    cur({ id: 'd', supplierSku: 'P-9', name: 'פטרוזיליה', priceUnits: 20000, monthlyQty: 5 }),
    cur({ id: 'e', supplierSku: 'X-0', name: 'פריט ישן', priceUnits: 10000, active: false }),
  ];

  it('classifies up / down / same / new / unclear / missing with ₪/month in agorot', () => {
    const d = buildImportDiff(current, [
      { rowNumber: 2, supplierSku: 'T-1', name: 'עגבניה', priceUnits: 55000 }, // +₪0.50 × 120 = ₪60
      { rowNumber: 3, supplierSku: 'C-2', name: 'מלפפון', priceUnits: 37500 }, // −₪0.25 × 80 = −₪20
      { rowNumber: 4, supplierSku: null, name: ' בצל  יבש ', priceUnits: 30000 }, // same, by normalizeLinkName
      { rowNumber: 5, supplierSku: 'N-1', name: 'שום', priceUnits: 90000 }, // new
      { rowNumber: 6, supplierSku: 'Q-1', name: 'כוסברה', priceUnits: null }, // unclear price
      { rowNumber: 7, supplierSku: 'T-1', name: 'עגבניה', priceUnits: 56000 }, // duplicate
    ]);
    const byRow = new Map(d.lines.map((l) => [l.rowNumber ?? `m:${l.currentId}`, l]));
    expect(byRow.get(2)).toMatchObject({ kind: 'up', deltaUnits: 5000, monthlyImpactAgorot: 6000 });
    expect(byRow.get(3)).toMatchObject({ kind: 'down', deltaUnits: -2500, monthlyImpactAgorot: -2000 });
    expect(byRow.get(4)).toMatchObject({ kind: 'same', currentId: 'c', monthlyImpactAgorot: 0 });
    expect(byRow.get(5)).toMatchObject({ kind: 'new', currentId: null });
    expect(byRow.get(6)).toMatchObject({ kind: 'unclear', unclearReason: 'NO_PRICE' });
    expect(byRow.get(7)).toMatchObject({ kind: 'unclear', unclearReason: 'DUPLICATE_IN_FILE', currentId: 'a' });
    // P-9 is active and absent → missing (suggested to disable); the inactive X-0 is not.
    expect(byRow.get('m:d')).toMatchObject({ kind: 'missing', rowNumber: null });
    expect(byRow.has('m:e')).toBe(false);
    expect(d.counts).toEqual({ up: 1, down: 1, same: 1, new: 1, unclear: 2, missing: 1 });
    expect(d).toMatchObject({ upAgorot: 6000, downAgorot: 2000, netAgorot: 4000 });
  });

  it('orders the money first: rises by ₪/month, then falls, unclear, missing, new, same', () => {
    const d = buildImportDiff(current, [
      { rowNumber: 2, supplierSku: 'T-1', name: 'עגבניה', priceUnits: 50100 }, // +₪0.12/month
      { rowNumber: 3, supplierSku: 'C-2', name: 'מלפפון', priceUnits: 40000 },
      { rowNumber: 4, supplierSku: 'P-9', name: 'פטרוזיליה', priceUnits: 30000 }, // +₪5.00/month
    ]);
    expect(d.lines.map((l) => [l.kind, l.currentId])).toEqual([
      ['up', 'd'],
      ['up', 'a'],
      ['missing', 'c'],
      ['same', 'b'],
    ]);
  });

  it('a row with no name and no SKU is unclear, never matched', () => {
    const d = buildImportDiff(current, [{ rowNumber: 9, supplierSku: '  ', name: '   ', priceUnits: 100 }]);
    expect(d.lines[0]).toMatchObject({ kind: 'unclear', unclearReason: 'NO_NAME', currentId: null });
  });

  it('a priced row whose current twin has no price is new, with no ₪ impact', () => {
    const d = buildImportDiff([cur({ id: 'z', supplierSku: 'Z', name: 'זעתר' })], [
      { rowNumber: 2, supplierSku: 'Z', name: 'זעתר', priceUnits: 1000 },
    ]);
    expect(d.lines[0]).toMatchObject({ kind: 'new', currentId: 'z', monthlyImpactAgorot: 0 });
    expect(d.netAgorot).toBe(0);
  });
});
