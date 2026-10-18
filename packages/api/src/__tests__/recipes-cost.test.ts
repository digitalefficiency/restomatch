import { describe, expect, it } from 'vitest';
import {
  applyPriceChange,
  assertNoCycle,
  costLight,
  costRecipes,
  formatScaled,
  netMenuPrice,
  parseScaled,
  RecipeCycleError,
  roundHalfUp,
  simulatePriceChange,
  unitFactorRational,
  vatRateToBp,
  type CostItem,
  type CostRecipe,
  type ProductPrice,
} from '../recipes/cost';

/**
 * Recipe cost engine — unit math + rounding. The property tests use a seeded
 * PRNG (mulberry32) so every run is deterministic and reproducible from the
 * printed seed, without adding a property-testing dependency to @restomatch/api.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RUNS = 2000;
function property(name: string, seed: number, body: (rnd: () => number, i: number) => void) {
  it(`${name} (seed ${seed}, ${RUNS} runs)`, () => {
    const rnd = mulberry32(seed);
    for (let i = 0; i < RUNS; i++) body(rnd, i);
  });
}
const int = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
/** A NUMERIC(12,4)-shaped decimal string in [0, max]. */
const dec4 = (rnd: () => number, maxUnits: number, minUnits = 1) => formatScaled(BigInt(int(rnd, minUnits, maxUnits)), 4);

const VAT = vatRateToBp('0.1800');

function dish(id: string, items: CostItem[], over: Partial<CostRecipe> = {}): CostRecipe {
  return {
    id,
    name: id,
    isSubRecipe: false,
    yieldQty: '1',
    yieldUnit: 'מנה',
    menuPriceAgorot: null,
    menuPriceIncludesVat: true,
    items,
    ...over,
  };
}
function line(id: string, productId: string, quantity: string, unit: string, wastePct = '0', extra: Partial<CostItem> = {}): CostItem {
  return { id, productId, subRecipeId: null, quantity, unit, wastePct, unitsPerProductUnit: null, ...extra };
}
function prices(entries: Record<string, ProductPrice>) {
  return new Map(Object.entries(entries));
}
function costOne(r: CostRecipe, p: Map<string, ProductPrice>, all: CostRecipe[] = [r]) {
  return costRecipes(all, p, VAT).get(r.id)!;
}

describe('scaled decimals + half-up rounding', () => {
  it('parses NUMERIC strings exactly and rounds half-up beyond the scale', () => {
    expect(parseScaled('38.9000', 4)).toBe(389000n);
    expect(parseScaled('12', 4)).toBe(120000n);
    expect(parseScaled('0.00005', 4)).toBe(1n); // half-up
    expect(parseScaled('0.00004', 4)).toBe(0n);
    expect(parseScaled('5.25', 2)).toBe(525n);
    expect(() => parseScaled('1e3', 4)).toThrow(RangeError);
    expect(() => parseScaled('abc', 4)).toThrow(RangeError);
  });

  it('rounds exact halves UP, not to even', () => {
    expect(roundHalfUp(1n, 2n)).toBe(1n); // 0.5 → 1
    expect(roundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3 (banker's would give 2)
    expect(roundHalfUp(7n, 2n)).toBe(4n); // 3.5 → 4
    expect(roundHalfUp(149n, 100n)).toBe(1n);
    expect(roundHalfUp(150n, 100n)).toBe(2n);
  });

  property('roundHalfUp(N, D) is within [-½, ½) of N/D', 1, (rnd) => {
    const n = BigInt(int(rnd, 0, 1e9));
    const d = BigInt(int(rnd, 1, 1e6));
    const r = roundHalfUp(n, d);
    const twice = 2n * n - 2n * r * d; // 2D × (N/D − r)
    expect(twice >= -d && twice < d).toBe(true);
  });

  property('formatScaled ∘ parseScaled is the identity', 2, (rnd) => {
    const v = BigInt(int(rnd, 0, 1e12));
    expect(parseScaled(formatScaled(v, 4), 4)).toBe(v);
  });
});

describe('unit conversions (units.ts + count/portion synonyms)', () => {
  it('converts mass/volume exactly and treats count/portion synonyms as one unit', () => {
    expect(unitFactorRational('g', 'ק״ג')).toEqual([1000n, 1_000_000n]);
    expect(unitFactorRational('ק"ג', 'גרם')).toEqual([1_000_000_000n, 1_000_000n]);
    expect(unitFactorRational('ml', 'ליטר')).toEqual([1000n, 1_000_000n]);
    expect(unitFactorRational('יח׳', 'unit')).toEqual([1n, 1n]);
    expect(unitFactorRational('מנה', 'portion')).toEqual([1n, 1n]);
    expect(unitFactorRational('g', 'ליטר')).toBeNull();
    expect(unitFactorRational('צרור', 'g')).toBeNull();
  });

  property('180 g at ₪/kg costs exactly what 0.18 kg does', 3, (rnd) => {
    const grams = int(rnd, 1, 50_000); // up to 5 kg in whole grams
    const price = dec4(rnd, 3_000_000); // up to ₪300/kg
    const p = prices({ x: { unitPrice: price, unit: 'ק״ג' } });
    const inGrams = costOne(dish('a', [line('l', 'x', `${grams}`, 'גרם')]), p);
    const inKg = costOne(dish('a', [line('l', 'x', formatScaled(BigInt(grams) * 10n, 4), 'ק״ג')]), p);
    expect(inGrams.batchCostAgorot).toBe(inKg.batchCostAgorot);
  });

  property('a line is within ½ agora of the exact cost', 4, (rnd) => {
    const q = BigInt(int(rnd, 1, 100_000)); // qty × 10^4 (≤ 10 units)
    const p = BigInt(int(rnd, 1, 5_000_000)); // price × 10^4 (≤ ₪500)
    const w = int(rnd, 0, 9_000); // waste bp
    const r = dish('a', [line('l', 'x', formatScaled(q, 4), 'ק״ג', formatScaled(BigInt(w), 2))]);
    const got = BigInt(costOne(r, prices({ x: { unitPrice: formatScaled(p, 4), unit: 'ק״ג' } })).batchCostAgorot);
    // exact agorot = q·p·100 / (10^4 · 10^4) / (1 − w/10^4)  ⇒  compare 2·D·(got − exact) ∈ [−D, D)
    const n = q * p * 100n * 10_000n;
    const d = 10_000n * 10_000n * (10_000n - BigInt(w));
    const twice = 2n * got * d - 2n * n;
    expect(twice >= -d && twice <= d).toBe(true);
  });

  property('more waste never makes a line cheaper', 5, (rnd) => {
    const q = dec4(rnd, 50_000);
    const price = { x: { unitPrice: dec4(rnd, 2_000_000), unit: 'ק״ג' } };
    const w1 = int(rnd, 0, 9_000);
    const w2 = int(rnd, w1, 9_500);
    const c1 = costOne(dish('a', [line('l', 'x', q, 'ק״ג', formatScaled(BigInt(w1), 2))]), prices(price));
    const c2 = costOne(dish('a', [line('l', 'x', q, 'ק״ג', formatScaled(BigInt(w2), 2))]), prices(price));
    expect(c2.batchCostAgorot).toBeGreaterThanOrEqual(c1.batchCostAgorot);
  });

  property('doubling the quantity doubles the cost (±1 agora)', 6, (rnd) => {
    const q = BigInt(int(rnd, 1, 40_000));
    const price = prices({ x: { unitPrice: dec4(rnd, 2_000_000), unit: 'ק״ג' } });
    const one = costOne(dish('a', [line('l', 'x', formatScaled(q, 4), 'ק״ג')]), price).batchCostAgorot;
    const two = costOne(dish('a', [line('l', 'x', formatScaled(2n * q, 4), 'ק״ג')]), price).batchCostAgorot;
    expect(Math.abs(two - 2 * one)).toBeLessThanOrEqual(1);
  });

  property('a sub-recipe costs the same as inlining it (±1 agora per line)', 7, (rnd) => {
    const nLines = int(rnd, 1, 4);
    const p: Record<string, ProductPrice> = {};
    const subItems: CostItem[] = [];
    for (let k = 0; k < nLines; k++) {
      p[`p${k}`] = { unitPrice: dec4(rnd, 1_000_000), unit: 'ק״ג' };
      subItems.push(line(`s${k}`, `p${k}`, dec4(rnd, 20_000), 'ק״ג'));
    }
    const yieldKg = BigInt(int(rnd, 1_000, 50_000)); // 0.1–5 kg batch
    const sub = dish('sauce', subItems, { isSubRecipe: true, yieldQty: formatScaled(yieldKg, 4), yieldUnit: 'ק״ג' });
    const usedG = BigInt(int(rnd, 1, 500));
    const user = dish('dish', [{ id: 'u', productId: null, subRecipeId: 'sauce', quantity: `${usedG}`, unit: 'גרם', wastePct: '0', unitsPerProductUnit: null }]);
    const viaSub = costRecipes([sub, user], prices(p), VAT).get('dish')!.batchCostAgorot;
    // inline exact: Σ line_exact × used / yield
    let exact = 0;
    const subCost = costRecipes([sub], prices(p), VAT).get('sauce')!;
    exact = (subCost.batchCostAgorot * Number(usedG)) / (Number(yieldKg) / 10); // yield in grams = yieldKg/10^4 × 1000
    expect(Math.abs(viaSub - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('uses the manual bridge for non-convertible units (a tray of 30 eggs)', () => {
    const p = prices({ eggs: { unitPrice: '34.0000', unit: 'תבנית' } });
    const r = dish('omelette', [line('l', 'eggs', '3', 'יח׳', '0', { unitsPerProductUnit: '30' })]);
    expect(costOne(r, p).batchCostAgorot).toBe(340); // 3/30 × ₪34 = ₪3.40
    const noBridge = costOne(dish('o2', [line('l', 'eggs', '3', 'יח׳')]), p);
    expect(noBridge.lines[0]!.status).toBe('unitMismatch');
    expect(noBridge.complete).toBe(false);
  });

  it('flags a product with no paid price instead of costing it at zero silently', () => {
    const r = costOne(dish('a', [line('l', 'nope', '1', 'ק״ג')]), prices({}));
    expect(r.lines[0]!.status).toBe('missingPrice');
    expect(r.complete).toBe(false);
  });
});

describe('dish economics', () => {
  it('nets VAT out of the menu price and computes food-cost % + margin per plate', () => {
    // Schnitzel: 200 g chicken breast @ ₪38.90/kg with 10% trim, ₪68 on the menu incl. 18% VAT.
    const p = prices({ chicken: { unitPrice: '38.9000', unit: 'ק״ג' } });
    const r = costOne(dish('schnitzel', [line('l', 'chicken', '200', 'גרם', '10')], { menuPriceAgorot: 6800 }), p);
    // 0.2 kg / 0.9 × 38.90 = 8.6444… → 864 agorot (half-up).
    expect(r.portionCostAgorot).toBe(864);
    expect(r.netMenuPriceAgorot).toBe(5763); // 6800 / 1.18 = 5762.71 → 5763
    expect(r.grossMarginAgorot).toBe(5763 - 864);
    expect(r.foodCostBp).toBe(1499); // 864 / 5763 = 14.99%
    expect(netMenuPrice(6800, false, VAT)).toBe(6800);
  });

  it('divides a multi-portion batch per plate (half-up)', () => {
    const p = prices({ rice: { unitPrice: '9.8000', unit: 'ק״ג' } });
    const r = costOne(dish('rice-pot', [line('l', 'rice', '1', 'ק״ג')], { yieldQty: '7' }), p);
    expect(r.batchCostAgorot).toBe(980);
    expect(r.portionCostAgorot).toBe(140);
  });

  it('price-change impact: chicken +12% raises the schnitzel food cost and cuts the margin per plate', () => {
    const p = prices({
      chicken: { unitPrice: '38.9000', unit: 'ק״ג' },
      flour: { unitPrice: '4.9200', unit: 'ק״ג' },
    });
    const schnitzel = dish('schnitzel', [line('a', 'chicken', '250', 'גרם', '8'), line('b', 'flour', '40', 'גרם')], {
      menuPriceAgorot: 3900,
    });
    const salad = dish('salad', [line('c', 'flour', '10', 'גרם')], { menuPriceAgorot: 3200 });
    const rows = simulatePriceChange([schnitzel, salad], p, VAT, 'chicken', 1200);
    expect(rows.map((r) => r.recipeId)).toEqual(['schnitzel']);
    const [row] = rows;
    expect(row!.after.foodCostBp!).toBeGreaterThan(row!.before.foodCostBp!);
    expect(row!.marginDeltaAgorot).toBe(-row!.portionCostDeltaAgorot);
    // 0.25/0.92 × 38.90 = 10.5706 → 1057; after: × 1.12 (43.568) = 11.8391 → 1184.
    expect(row!.before.portionCostAgorot).toBe(1057 + 20);
    expect(row!.after.portionCostAgorot).toBe(1184 + 20);
    expect(applyPriceChange('38.9000', 1200)).toBe('43.5680');
    expect(applyPriceChange('10.0000', -2500)).toBe('7.5000');
  });

  property('a price rise never lowers any dish cost; a cut never raises it', 8, (rnd) => {
    const p = prices({ a: { unitPrice: dec4(rnd, 1_000_000), unit: 'ק״ג' }, b: { unitPrice: dec4(rnd, 1_000_000), unit: 'ליטר' } });
    const r = dish('d', [line('1', 'a', dec4(rnd, 10_000), 'גרם'), line('2', 'b', dec4(rnd, 10_000), 'מ״ל')], { menuPriceAgorot: int(rnd, 100, 20_000) });
    const change = int(rnd, -5_000, 5_000);
    const rows = simulatePriceChange([r], p, VAT, 'a', change);
    for (const row of rows) {
      if (change > 0) expect(row.portionCostDeltaAgorot).toBeGreaterThan(0);
      if (change < 0) expect(row.portionCostDeltaAgorot).toBeLessThan(0);
    }
  });

  property('food-cost bp is within ½ bp of portion / net', 9, (rnd) => {
    const p = prices({ a: { unitPrice: dec4(rnd, 2_000_000), unit: 'ק״ג' } });
    const menu = int(rnd, 500, 30_000);
    const r = costOne(dish('d', [line('1', 'a', dec4(rnd, 5_000), 'ק״ג')], { menuPriceAgorot: menu }), p);
    const exact = (r.portionCostAgorot * 10_000) / r.netMenuPriceAgorot!;
    expect(Math.abs(r.foodCostBp! - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('traffic light: green ≤ target, amber within 3 points, red above', () => {
    expect(costLight(2999, 3000)).toBe('green');
    expect(costLight(3000, 3000)).toBe('green');
    expect(costLight(3300, 3000)).toBe('amber');
    expect(costLight(3301, 3000)).toBe('red');
    expect(costLight(null, 3000)).toBe('none');
  });
});

describe('sub-recipe cycles', () => {
  it('rejects a save that would close a cycle and marks cyclic lines when costing', () => {
    const edges = new Map<string, string[]>([
      ['sauce', ['base']],
      ['base', []],
    ]);
    expect(() => assertNoCycle('base', ['sauce'], edges)).toThrow(RecipeCycleError);
    expect(() => assertNoCycle('dish', ['sauce'], edges)).not.toThrow();
    const a = dish('a', [{ id: 'x', productId: null, subRecipeId: 'b', quantity: '1', unit: 'מנה', wastePct: '0', unitsPerProductUnit: null }]);
    const b = dish('b', [{ id: 'y', productId: null, subRecipeId: 'a', quantity: '1', unit: 'מנה', wastePct: '0', unitsPerProductUnit: null }]);
    const res = costRecipes([a, b], prices({}), VAT);
    expect(res.get('a')!.complete).toBe(false);
    expect([...res.values()].some((r) => r.lines.some((l) => l.status === 'cycle'))).toBe(true);
  });
});

describe('overflow is contained', () => {
  it('an absurd recipe gets `overflow` lines; its neighbours still cost normally', () => {
    const p = prices({ x: { unitPrice: '40.0000', unit: 'ק״ג' } });
    const tiny = dish('tiny', [line('t', 'x', '10', 'ק״ג')], { isSubRecipe: true, yieldQty: '0.0001' });
    const huge = dish('huge', [{ id: 'h', productId: null, subRecipeId: 'tiny', quantity: '99999999', unit: 'מנה', wastePct: '95', unitsPerProductUnit: null }]);
    const fine = dish('fine', [line('f', 'x', '1', 'ק״ג')]);
    const res = costRecipes([tiny, huge, fine], p, VAT);
    expect(res.get('huge')!.lines[0]!.status).toBe('overflow');
    expect(res.get('huge')!.complete).toBe(false);
    expect(res.get('fine')!.batchCostAgorot).toBe(4000);
  });
});
