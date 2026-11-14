import { describe, expect, it } from 'vitest';
import { deriveChanges, type ChangesInput, type PaidPrice } from '../recipes/changes';
import type { ItemRow, RecipeRow } from '../recipes/data';

/**
 * recipes/changes.ts · deriveChanges is pure (no DB), so AU-13's digest can
 * build its dish section from it: each dish costed at the month-start prices
 * vs now, the line that moved it most (driver) and the same-supplier price rise
 * (riser). Never a riser for a supplier switch or a price drop.
 */
const recipe = (id: string, name: string, menu: number | null, isSub = false): RecipeRow => ({
  id,
  name,
  nameEn: null,
  category: null,
  isSubRecipe: isSub,
  yieldQty: '1',
  yieldUnit: 'מנה',
  menuPriceAgorot: menu,
  menuPriceIncludesVat: true,
  active: true,
  notes: null,
  updatedAt: new Date(0),
});
const item = (id: string, recipeId: string, productId: string, quantity: string, unit = 'ק״ג'): ItemRow => ({
  id,
  recipeId,
  productId,
  subRecipeId: null,
  quantity,
  unit,
  wastePct: '0.00',
  unitsPerProductUnit: null,
  sortOrder: 0,
  note: null,
});
const price = (unitPrice: string, supplierId = 's1'): PaidPrice => ({ unitPrice, unit: 'ק״ג', supplierId });

function input(before: Record<string, PaidPrice>, now: Record<string, PaidPrice>): ChangesInput {
  return {
    since: new Date('2026-11-01T00:00:00+02:00'),
    targetBp: 3000,
    vatBp: 1800n,
    rows: [recipe('d1', 'שניצל', 5900), recipe('d2', 'סלט', 3800)],
    items: [item('i1', 'd1', 'chicken', '0.2'), item('i2', 'd1', 'flour', '0.05'), item('i3', 'd2', 'tomato', '0.3')],
    before: new Map(Object.entries(before)),
    now: new Map(Object.entries(now)),
    productInfo: new Map([
      ['chicken', { id: 'chicken', name: 'חזה עוף', nameEn: 'Chicken', unit: 'ק״ג', category: null }],
      ['flour', { id: 'flour', name: 'קמח', nameEn: null, unit: 'ק״ג', category: null }],
      ['tomato', { id: 'tomato', name: 'עגבנייה', nameEn: null, unit: 'ק״ג', category: null }],
    ]),
    supplierInfo: new Map([
      ['s1', { name: 'עוף טוב', nameEn: null }],
      ['s2', { name: 'ספק אחר', nameEn: null }],
    ]),
  };
}

describe('deriveChanges (pure)', () => {
  it('a same-supplier rise: cost delta, driver and riser name the product, the prices and who charged it', () => {
    const out = deriveChanges(input({ chicken: price('38.9000'), flour: price('4.9200'), tomato: price('6.0000') }, { chicken: price('43.5680'), flour: price('4.9200'), tomato: price('6.0000') }));
    expect(out.targetBp).toBe(3000);
    expect(out.activeDishCount).toBe(2);
    const d1 = out.rows.find((r) => r.recipeId === 'd1')!;
    // 0.2 kg × ₪38.90 = ₪7.78 → 0.2 × ₪43.568 = ₪8.7136 → 871 agorot; flour ₪0.246 → 25.
    expect([d1.beforeCostAgorot, d1.afterCostAgorot, d1.costDeltaAgorot]).toEqual([803, 896, 93]);
    expect(d1.driver).toMatchObject({ kind: 'product', name: 'חזה עוף', priceBefore: '38.9000', priceNow: '43.5680', supplier: { id: 's1', name: 'עוף טוב' } });
    expect(d1.riser).toMatchObject({ name: 'חזה עוף', deltaAgorot: 93, supplier: { id: 's1' } });
    const d2 = out.rows.find((r) => r.recipeId === 'd2');
    expect(d2 === undefined || d2.costDeltaAgorot === 0).toBe(true);
  });

  it('a supplier switch or a price drop is never a riser', () => {
    const sw = deriveChanges(input({ chicken: price('38.9000', 's1'), flour: price('4.9200') }, { chicken: price('43.5680', 's2'), flour: price('4.9200') }));
    expect(sw.rows.find((r) => r.recipeId === 'd1')!.riser).toBeNull();
    const drop = deriveChanges(input({ chicken: price('43.5680'), flour: price('4.9200') }, { chicken: price('38.9000'), flour: price('4.9200') }));
    const d1 = drop.rows.find((r) => r.recipeId === 'd1')!;
    expect(d1.costDeltaAgorot).toBeLessThan(0);
    expect(d1.riser).toBeNull();
  });

  it('is deterministic and does not mutate its inputs', () => {
    const inp = input({ chicken: price('38.9000') }, { chicken: price('43.5680') });
    const snapshot = JSON.stringify([...inp.before], null) + JSON.stringify([...inp.now]);
    expect(deriveChanges(inp)).toEqual(deriveChanges(inp));
    expect(JSON.stringify([...inp.before], null) + JSON.stringify([...inp.now])).toBe(snapshot);
  });
});
