import { describe, expect, it } from 'vitest';
import { parseRecipeCsv } from '../recipes/csv';

/**
 * G-13 (catalog-02 class): the recipe import's menu price goes through
 * parseDecimalInput('ils'). Before: the cell was comma-stripped, so "12,90"
 * was refused as badPrice. Now "12,90" is ₪12.90, "1,250" is ₪1,250 and
 * "1.250" (₪1,250 or ₪1.25?) is reported with its reason — never guessed.
 */
const csv = (price: string) => `recipe,ingredient,quantity,unit,menu_price\nשקשוקה,ביצים,2,יח,"${price}"\n`;
const one = (price: string) => {
  const out = parseRecipeCsv(csv(price));
  return { price: out.recipes[0]?.menuPriceAgorot ?? null, errors: out.errors };
};

describe('recipe CSV: menu price via parseDecimalInput', () => {
  it.each<[string, number]>([
    ['12,90', 1290],
    ['1,250', 125_000],
    ['68', 6800],
    ['68.50', 6850],
    ['1,250.00', 125_000],
    ['₪ 2,400', 240_000],
    ['42 ₪', 4200],
  ])('%s → %i agorot', (price, agorot) => {
    expect(one(price)).toEqual({ price: agorot, errors: [] });
  });

  it('"1.250" is ambiguous → badPrice with the reason, no price imported', () => {
    expect(one('1.250')).toEqual({
      price: null,
      errors: [{ row: 2, code: 'badPrice', value: '1.250', reason: 'thousands-or-three-decimals' }],
    });
  });

  it.each<[string, string]>([
    ['-5', 'negative-not-allowed'],
    ['abc', 'not-a-number'],
    ['12.345', 'thousands-or-three-decimals'],
    ['12.3456', 'too-many-decimals'],
    ['1.234,50', 'comma-decimal-needs-comma-file'],
  ])('%s → badPrice (%s)', (price, reason) => {
    expect(one(price).errors).toEqual([{ row: 2, code: 'badPrice', value: price, reason }]);
  });

  it('above the ₪100,000 cap → badPrice without a parse reason', () => {
    expect(one('100,000.01').errors).toEqual([{ row: 2, code: 'badPrice', value: '100,000.01' }]);
  });
});
