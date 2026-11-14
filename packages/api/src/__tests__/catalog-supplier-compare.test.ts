import { describe, expect, it } from 'vitest';
import { compareSuppliers } from '../catalog/supplierCompare';

describe('W3-10 supplier comparison per base unit', () => {
  it('normalises kg / g / pack to one comparable price and flags the cheapest', () => {
    const r = compareSuppliers([
      { supplierId: 'a', priceUnits: 120000, unit: 'ק״ג', packSize: null }, // ₪12/kg
      { supplierId: 'b', priceUnits: 6500, unit: 'גרם', packSize: null }, // ₪0.65/g = ₪650/kg
      { supplierId: 'c', priceUnits: 55000, unit: '500g', packSize: null }, // unreadable unit
      { supplierId: 'd', priceUnits: 54000, unit: 'kg', packSize: 10 }, // ₪5.40/kg; packSize ignored for mass
    ]);
    expect(r.baseUnit).toBe('kg');
    const by = Object.fromEntries(r.offers.map((o) => [o.supplierId, o]));
    expect(by.a).toMatchObject({ status: 'ok', perBaseUnits: 120000, cheapest: false, gapBp: 12222 });
    expect(by.b).toMatchObject({ status: 'ok', perBaseUnits: 6500000 });
    expect(by.c).toMatchObject({ status: 'unclear', perBaseUnits: null, cheapest: false, gapBp: null });
    expect(by.d).toMatchObject({ status: 'ok', perBaseUnits: 54000, cheapest: true, gapBp: 0 });
  });

  it('a case is divided by its pack size into a price per item', () => {
    const r = compareSuppliers([
      { supplierId: 'a', priceUnits: 600000, unit: 'ארגז', packSize: 12 }, // ₪60/12 = ₪5/יח׳
      { supplierId: 'b', priceUnits: 45000, unit: 'יח׳', packSize: null }, // ₪4.50/יח׳
      { supplierId: 'c', priceUnits: 600000, unit: 'ארגז', packSize: null }, // pack with no size → unclear
    ]);
    expect(r.baseUnit).toBe('unit');
    expect(r.offers.map((o) => [o.supplierId, o.status, o.perBaseUnits, o.cheapest])).toEqual([
      ['a', 'ok', 50000, false],
      ['b', 'ok', 45000, true],
      ['c', 'unclear', null, false],
    ]);
  });

  it('offers in another dimension are unclear for this view, not converted', () => {
    const r = compareSuppliers([
      { supplierId: 'a', priceUnits: 100, unit: 'kg', packSize: null },
      { supplierId: 'b', priceUnits: 100, unit: 'kg', packSize: null },
      { supplierId: 'c', priceUnits: 100, unit: 'ליטר', packSize: null },
    ]);
    expect(r.baseUnit).toBe('kg');
    expect(r.offers[2]).toMatchObject({ status: 'unclear' });
  });

  it('a single offer is not "cheapest" (nothing to compare)', () => {
    const r = compareSuppliers([{ supplierId: 'a', priceUnits: 100, unit: 'kg', packSize: null }]);
    expect(r.offers[0]).toMatchObject({ status: 'ok', cheapest: false, gapBp: null });
  });
});
