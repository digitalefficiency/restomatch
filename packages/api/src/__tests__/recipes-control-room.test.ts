import { describe, expect, it } from 'vitest';
import { categorySplit, equation, periodSeries, topUnexplained } from '../inventory/controlRoom';

/**
 * W3-02 slice b · the food-cost control room's pure core. The equation adds
 * up to the agora, each term drills to its source, the sparkline never draws
 * a missing period as 0%, category shares sum to exactly 100%, and
 * "unexplained" never ranks raw usage without a POS theory.
 */
const base = {
  opening: { countId: 'c1', countDate: '2026-09-30', valueAgorot: 827_996 },
  closing: { countId: 'c2', countDate: '2026-10-24', valueAgorot: 949_066 },
  purchasesAgorot: 3_792_701,
  creditsAgorot: 47_138,
  salesAgorot: 13_640_000,
  salesSource: 'manual' as const,
};

describe('equation', () => {
  it('opening + purchases − credits − closing = usage, to the agora; usage ÷ sales half-up', () => {
    const e = equation(base);
    expect(e.usageAgorot).toBe(827_996 + 3_792_701 - 47_138 - 949_066);
    expect(e.usageAgorot).toBe(3_624_493);
    // 3,624,493 / 13,640,000 = 0.265725…, so 2657 bp (26.6%).
    expect(e.actualBp).toBe(2657);
    expect(e.terms.map((t) => [t.key, t.sign])).toEqual([['opening', 1], ['purchases', 1], ['credits', -1], ['closing', -1]]);
  });

  it('every term drills to its source', () => {
    const e = equation(base);
    expect(e.terms.find((t) => t.key === 'purchases')!.drill).toEqual({ kind: 'invoices', from: '2026-09-30', to: '2026-10-24' });
    expect(e.terms.find((t) => t.key === 'credits')!.drill).toEqual({ kind: 'credits', from: '2026-09-30', to: '2026-10-24' });
    expect(e.terms.find((t) => t.key === 'closing')!.drill).toEqual({ kind: 'count', countId: 'c2' });
    expect(e.sales.drill).toEqual({ kind: 'sales', countId: 'c2', source: 'manual' });
  });

  it('no %, never a fake one, without positive sales or with negative usage', () => {
    expect(equation({ ...base, salesAgorot: null }).actualBp).toBeNull();
    expect(equation({ ...base, salesAgorot: 0 }).actualBp).toBeNull();
    expect(equation({ ...base, closing: { ...base.closing, valueAgorot: 99_000_000 } }).actualBp).toBeNull();
  });
});

describe('periodSeries', () => {
  it('oldest → newest, gaps stay gaps (never 0%), implausible points drop out; latest + delta', () => {
    const s = periodSeries(
      [
        { closingCountId: 'c3', closingDate: '2026-10-24', actualBp: 2657 },
        { closingCountId: 'c1', closingDate: '2026-08-31', actualBp: 2810 },
        { closingCountId: 'c2', closingDate: '2026-09-30', actualBp: null },
        { closingCountId: 'c0', closingDate: '2026-07-31', actualBp: 9100, implausible: true },
      ],
      3000,
    );
    expect(s.points.map((p) => p.bp)).toEqual([null, 2810, null, 2657]);
    expect([s.minBp, s.maxBp]).toEqual([2657, 3000]);
    expect(s.latest).toEqual({ closingDate: '2026-10-24', bp: 2657, deltaBp: -153 });
  });

  it('keeps only the last `max` periods; no data → latest null, scale is the target', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ closingCountId: `c${i}`, closingDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String(10 + Math.floor(i / 12)).padStart(2, '0')}`, actualBp: 2500 + i }));
    expect(periodSeries(many, 3000).points).toHaveLength(12);
    const empty = periodSeries([], 3000);
    expect([empty.latest, empty.minBp, empty.maxBp]).toEqual([null, 3000, 3000]);
  });
});

describe('categorySplit', () => {
  it('usage per category, largest first, shares sum to exactly 10,000', () => {
    const rows = categorySplit([
      { category: 'בשר', openingAgorot: 300_000, purchasesAgorot: 1_500_000, creditsAgorot: 20_000, closingAgorot: 400_000 },
      { category: 'ירקות', openingAgorot: 50_000, purchasesAgorot: 600_000, creditsAgorot: 0, closingAgorot: 60_000 },
      { category: 'בשר', openingAgorot: 0, purchasesAgorot: 10_000, creditsAgorot: 0, closingAgorot: 0 },
      { category: null, openingAgorot: 0, purchasesAgorot: 33_333, creditsAgorot: 0, closingAgorot: 0 },
    ]);
    expect(rows.map((r) => [r.category, r.usageAgorot])).toEqual([['בשר', 1_390_000], ['ירקות', 590_000], [null, 33_333]]);
    expect(rows.reduce((a, r) => a + r.shareBp, 0)).toBe(10_000);
  });

  it('folds the tail into "__other__" and keeps a negative category with a 0 share', () => {
    const flows = ['א', 'ב', 'ג', 'ד'].map((c, i) => ({ category: c, openingAgorot: 0, purchasesAgorot: 1000 * (4 - i), creditsAgorot: 0, closingAgorot: 0 }));
    flows.push({ category: 'ה', openingAgorot: 0, purchasesAgorot: 0, creditsAgorot: 0, closingAgorot: 500 });
    const rows = categorySplit(flows, 3);
    expect(rows.map((r) => r.category)).toEqual(['א', 'ב', '__other__']);
    expect(rows[2]!.usageAgorot).toBe(2000 + 1000 - 500);
    const neg = categorySplit(flows, 10).find((r) => r.category === 'ה')!;
    expect([neg.usageAgorot, neg.shareBp]).toEqual([-500, 0]);
  });
});

describe('topUnexplained', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    productId: `p${i}`,
    name: `מוצר ${String(i).padStart(2, '0')}`,
    actualUsageAgorot: 10_000 + i * 1000,
    theoreticalUsageAgorot: i === 3 ? null : 10_000,
  }));

  it('top 10 by ₪ gap; no-recipe products carry their full usage and are labelled', () => {
    const top = topUnexplained(rows, true);
    expect(top).toHaveLength(10);
    expect(top.find((r) => r.productId === 'p13')).toMatchObject({ gapAgorot: 13_000, noRecipe: false });
    expect(top.find((r) => r.productId === 'p3')).toMatchObject({ gapAgorot: 13_000, noRecipe: true });
    expect(top.map((r) => r.gapAgorot)).toEqual([...top.map((r) => r.gapAgorot)].sort((a, b) => b - a));
    // A tie at 13,000 is ordered by name: "מוצר 03" before "מוצר 13".
    expect(top.slice(0, 2).map((r) => r.productId)).toEqual(['p3', 'p13']);
  });

  it('using less than the recipes say is never "unexplained"; no theory → empty, never raw usage', () => {
    expect(topUnexplained([{ productId: 'x', name: 'x', actualUsageAgorot: 5, theoreticalUsageAgorot: 9 }], true)).toEqual([]);
    expect(topUnexplained(rows, false)).toEqual([]);
  });
});
