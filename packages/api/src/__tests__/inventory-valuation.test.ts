import { describe, expect, it } from 'vitest';
import { actualFoodCost, valueCount, valueLine, VARIANCE_ALERT_BP } from '../inventory/valuation';

/** Inventory valuation + the actual-food-cost period (pure; flag `inventoryCount`). */

describe('valueLine', () => {
  it('qty × last paid price, ex-VAT, integer agorot', () => {
    expect(valueLine('2.5', 'ק״ג', { unitPrice: '139.0000', unit: 'ק״ג' })).toEqual({ status: 'ok', unitCost: '139.0000', valueAgorot: 34750 });
  });

  it('rounds ONCE per line, half-up to the agora', () => {
    // 0.333 × 10.0050 = 3.3316665 → ₪3.33; 0.5 × 0.0100 = 0.005 → 1 agora (half-up)
    expect(valueLine('0.333', 'ק״ג', { unitPrice: '10.0050', unit: 'ק״ג' }).valueAgorot).toBe(333);
    expect(valueLine('0.5', 'ק״ג', { unitPrice: '0.0100', unit: 'ק״ג' }).valueAgorot).toBe(1);
    expect(valueLine('0.4999', 'ק״ג', { unitPrice: '0.0100', unit: 'ק״ג' }).valueAgorot).toBe(0);
  });

  it('converts the counted unit to the priced unit through the shared unit table', () => {
    // 750 g of a ₪40/kg product = ₪30; the unit cost is per GRAM (₪0.0400)
    expect(valueLine('750', 'גרם', { unitPrice: '40.0000', unit: 'ק״ג' })).toEqual({ status: 'ok', unitCost: '0.0400', valueAgorot: 3000 });
    // 2 L counted in ml-priced oil: 2000 ml × ₪0.0340
    expect(valueLine('2', 'ליטר', { unitPrice: '0.0340', unit: 'מ״ל' }).valueAgorot).toBe(6800);
  });

  it('never guesses: no qty = not counted, no price = excluded, unconvertible unit = excluded', () => {
    expect(valueLine(null, 'ק״ג', { unitPrice: '1.0000', unit: 'ק״ג' })).toEqual({ status: 'notCounted', unitCost: null, valueAgorot: null });
    expect(valueLine('', 'ק״ג', { unitPrice: '1.0000', unit: 'ק״ג' }).status).toBe('notCounted');
    expect(valueLine('3', 'ק״ג', undefined)).toEqual({ status: 'noPrice', unitCost: null, valueAgorot: null });
    expect(valueLine('3', 'ארגז', { unitPrice: '50.0000', unit: 'ק״ג' }).status).toBe('unitMismatch');
  });

  it('a counted zero is counted (₪0), not "not counted"', () => {
    expect(valueLine('0', 'ק״ג', { unitPrice: '139.0000', unit: 'ק״ג' })).toEqual({ status: 'ok', unitCost: '139.0000', valueAgorot: 0 });
  });
});

describe('valueCount (partial counts, no-price items)', () => {
  it('totals only priced, counted lines and tallies the rest visibly', () => {
    const prices = new Map([
      ['beef', { unitPrice: '120.0000', unit: 'ק״ג' }],
      ['milk', { unitPrice: '5.0000', unit: 'ליטר' }],
    ]);
    const s = valueCount(
      [
        { productId: 'beef', qty: '5', unit: 'ק״ג' },
        { productId: 'milk', qty: '10', unit: 'ליטר' },
        { productId: 'tomato', qty: '3', unit: 'ק״ג' }, // no price
        { productId: 'rice', qty: null, unit: 'ק״ג' }, // not counted
      ],
      prices,
    );
    expect(s).toMatchObject({ totalValueAgorot: 65_000, lines: 4, counted: 3, notCounted: 1, unpriced: 1 });
    expect(s.values.get('tomato')!.status).toBe('noPrice');
  });
});

describe('actualFoodCost (opening + purchases − credits − closing)', () => {
  it('the period formula, % of sales half-up in basis points', () => {
    // credits received are their own term, not hidden in purchases
    const r = actualFoodCost({ openingAgorot: 110_000, purchasesAgorot: 285_000, creditsAgorot: 4_000, closingAgorot: 65_600, salesAgorot: 1_000_000, theoreticalAgorot: null });
    expect(r).toEqual({ actualAgorot: 325_400, actualBp: 3254, theoreticalBp: null, varianceAgorot: null, varianceBp: null, varianceAlert: false });
  });

  it('without sales there is a ₪ figure but no %', () => {
    expect(actualFoodCost({ openingAgorot: 1, purchasesAgorot: 2, creditsAgorot: 0, closingAgorot: 0, salesAgorot: null, theoreticalAgorot: 1 })).toMatchObject({
      actualAgorot: 3,
      actualBp: null,
      varianceAgorot: 2,
      varianceBp: null,
      varianceAlert: false,
    });
  });

  it('variance = actual − theoretical; T2 only above 2 points of sales', () => {
    const base = { openingAgorot: 0, creditsAgorot: 0, closingAgorot: 0, salesAgorot: 1_000_000 };
    // 2.00 points exactly: calm
    expect(actualFoodCost({ ...base, purchasesAgorot: 320_000, theoreticalAgorot: 300_000 })).toMatchObject({ varianceAgorot: 20_000, varianceBp: VARIANCE_ALERT_BP, varianceAlert: false });
    // 2.01 points: act now
    expect(actualFoodCost({ ...base, purchasesAgorot: 320_100, theoreticalAgorot: 300_000 })).toMatchObject({ varianceBp: 201, varianceAlert: true });
    // actual BELOW theory (negative variance) is never an alarm
    expect(actualFoodCost({ ...base, purchasesAgorot: 250_000, theoreticalAgorot: 300_000 })).toMatchObject({ varianceAgorot: -50_000, varianceBp: -500, varianceAlert: false });
  });

  it('closing stock above opening + purchases gives a negative actual (shown, not hidden)', () => {
    expect(actualFoodCost({ openingAgorot: 0, purchasesAgorot: 100, creditsAgorot: 0, closingAgorot: 500, salesAgorot: 10_000, theoreticalAgorot: null })).toMatchObject({ actualAgorot: -400, actualBp: -400 });
  });
});
