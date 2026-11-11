import { describe, expect, it } from 'vitest';
import { costRecipes, type CostRecipe, type PriceMap } from '../recipes/cost';
import { DRAFT_ID, previewDraft, sharesBp } from '../recipes/preview';

/**
 * W3-02 · recipes.preview's pure core: the draft is costed by costRecipes
 * itself (same ₪ to the agora as a save would show), plus the gap to target
 * and each line's share of the plate (largest remainder, Σ = 10,000 bp).
 */
const VAT = 1800n;
const prices: PriceMap = new Map([
  ['chicken', { unitPrice: '43.5680', unit: 'ק״ג' }],
  ['flour', { unitPrice: '4.9200', unit: 'ק״ג' }],
  ['oil', { unitPrice: '11.3333', unit: 'ליטר' }],
]);
const batter: CostRecipe = {
  id: 'batter',
  name: 'בלילה',
  isSubRecipe: true,
  yieldQty: '1',
  yieldUnit: 'ק״ג',
  menuPriceAgorot: null,
  menuPriceIncludesVat: true,
  items: [{ id: 'b1', productId: 'flour', subRecipeId: null, quantity: '1', unit: 'ק״ג', wastePct: '0.00', unitsPerProductUnit: null }],
};
const line = (productId: string | null, quantity: string, unit: string, sub: string | null = null) => ({
  productId,
  subRecipeId: sub,
  quantity,
  unit,
  wastePct: '0.00',
  unitsPerProductUnit: null,
});
const dish = {
  name: 'שניצל',
  isSubRecipe: false,
  yieldQty: '1',
  yieldUnit: 'מנה',
  menuPriceAgorot: 6900,
  menuPriceIncludesVat: true,
  items: [line('chicken', '200', 'גרם'), line(null, '150', 'גרם', 'batter'), line('oil', '50', 'מ״ל')],
};

describe('sharesBp', () => {
  it('sums to exactly 10,000 and stays within floor/ceil of the exact share', () => {
    for (const w of [[1, 1, 1], [871, 74, 57], [1, 2], [5], [3, 3, 3, 1], [9999, 1, 1]]) {
      const s = sharesBp(w);
      expect(s.reduce((a, b) => a + b, 0)).toBe(10_000);
      const total = w.reduce((a, b) => a + b, 0);
      s.forEach((x, i) => {
        const exact = (w[i]! * 10_000) / total;
        expect(x).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(x).toBeLessThanOrEqual(Math.ceil(exact));
      });
    }
    expect(sharesBp([1, 1, 1])).toEqual([3334, 3333, 3333]);
  });

  it('all zero (or nothing) → all 0', () => {
    expect(sharesBp([0, 0])).toEqual([0, 0]);
    expect(sharesBp([])).toEqual([]);
  });
});

describe('previewDraft', () => {
  it('costs a new draft exactly as costRecipes would, with the gap and the light', () => {
    const p = previewDraft([batter], dish, prices, VAT, 3000);
    const ref = costRecipes([batter, { ...dish, id: DRAFT_ID, items: dish.items.map((it, i) => ({ ...it, id: `draft:${i}` })) }], prices, VAT).get(DRAFT_ID)!;
    expect(p.portionCostAgorot).toBe(ref.portionCostAgorot);
    expect(p.batchCostAgorot).toBe(ref.batchCostAgorot);
    expect(p.foodCostBp).toBe(ref.foodCostBp);
    expect(p.grossMarginAgorot).toBe(ref.grossMarginAgorot);
    expect(p.lines.map((l) => l.costAgorot)).toEqual(ref.lines.map((l) => l.costAgorot));
    // 871 + 74 + 57 = 1,002 agorot; ₪69 incl. 18% VAT = 5,847 net.
    expect(p.portionCostAgorot).toBe(1002);
    expect(p.netMenuPriceAgorot).toBe(5847);
    expect(p.gapToTargetBp).toBe(p.foodCostBp! - 3000);
    expect(p.light).toBe('green');
    expect(p.complete).toBe(true);
    expect(p.lines.reduce((a, l) => a + l.shareBp, 0)).toBe(10_000);
    expect(p.lines.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  it('a draft with an existing id replaces the saved recipe (the edit, not the stored row)', () => {
    const savedDish: CostRecipe = { ...dish, id: 'dish1', items: [{ ...line('flour', '1', 'ק״ג'), id: 'x' }] };
    const p = previewDraft([batter, savedDish], { ...dish, id: 'dish1' }, prices, VAT, 3000);
    expect(p.portionCostAgorot).toBe(1002);
  });

  it('a missing price / unit mismatch is a line status, never an error; the plate is partial', () => {
    const p = previewDraft([batter], { ...dish, items: [line('chicken', '200', 'גרם'), line('ghost', '1', 'ק״ג'), line('oil', '1', 'ק״ג')] }, prices, VAT, 3000);
    expect(p.lines.map((l) => l.status)).toEqual(['ok', 'missingPrice', 'unitMismatch']);
    expect(p.complete).toBe(false);
    expect(p.lines[1]!.shareBp).toBe(0);
    expect(p.lines[0]!.shareBp).toBe(10_000);
  });

  it('no menu price → no food %, no gap, light none; a sub-recipe never has a gap', () => {
    const p = previewDraft([batter], { ...dish, menuPriceAgorot: null }, prices, VAT, 3000);
    expect([p.foodCostBp, p.gapToTargetBp, p.light]).toEqual([null, null, 'none']);
    const s = previewDraft([batter], { ...dish, isSubRecipe: true, yieldUnit: 'ק״ג' }, prices, VAT, 3000);
    expect([s.netMenuPriceAgorot, s.gapToTargetBp, s.light]).toEqual([null, null, 'none']);
  });

  it('a draft that uses itself is costed as a cycle line, not thrown', () => {
    const p = previewDraft([batter], { ...batter, items: [line(null, '1', 'ק״ג', 'batter')] }, prices, VAT, 3000);
    expect(p.lines[0]!.status).toBe('cycle');
  });

  it('an empty draft costs 0 with no lines', () => {
    const p = previewDraft([], { ...dish, items: [] }, prices, VAT, 3000);
    expect([p.portionCostAgorot, p.lines.length, p.complete]).toEqual([0, 0, true]);
  });
});
