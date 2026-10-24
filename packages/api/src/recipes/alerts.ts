import { parseScaled, roundHalfUp } from './cost';

/**
 * Dish price alerts (flag `dishPriceAlert`). Pure: fed the rows of
 * `computeChanges` (start-of-month vs now, per dish, with the driving line).
 *
 * A dish alerts when ALL hold:
 *   - it is an active dish on the menu (not a sub-recipe) with a menu price;
 *   - its food cost was at or under the target at the start of the month and
 *     is above it now (it CROSSED the target this month);
 *   - its cost per plate went up, and the line that moved it most is a product
 *     whose PAID unit price rose (not a recipe edit, not a sub-recipe).
 * Ordered by the ₪ per plate, biggest first.
 */

export interface ChangeRowLike {
  recipeId: string;
  name: string;
  nameEn: string | null;
  isSubRecipe: boolean;
  active: boolean;
  beforeFoodCostBp: number | null;
  afterFoodCostBp: number | null;
  costDeltaAgorot: number;
  driver: {
    kind: 'product' | 'subRecipe';
    name: string;
    nameEn: string | null;
    unit: string | null;
    deltaAgorot: number;
    priceBefore: string | null;
    priceNow: string | null;
    supplier: { id: string; name: string; nameEn: string | null } | null;
  } | null;
}

export interface DishPriceAlert {
  recipeId: string;
  name: string;
  nameEn: string | null;
  beforeFoodCostBp: number;
  afterFoodCostBp: number;
  /** Extra cost per plate this month (agorot). */
  costDeltaAgorot: number;
  product: {
    name: string;
    nameEn: string | null;
    unit: string | null;
    priceBefore: string;
    priceNow: string;
    /** Unit price change in agorot (half-up). */
    priceDeltaAgorot: number;
    /** Unit price change in basis points of the old price (half-up). */
    priceChangeBp: number;
  };
  supplier: { id: string; name: string; nameEn: string | null } | null;
}

export function dishPriceAlerts(rows: readonly ChangeRowLike[], targetBp: number): DishPriceAlert[] {
  const out: DishPriceAlert[] = [];
  for (const r of rows) {
    if (r.isSubRecipe || !r.active) continue;
    if (r.beforeFoodCostBp == null || r.afterFoodCostBp == null) continue;
    if (!(r.beforeFoodCostBp <= targetBp && r.afterFoodCostBp > targetBp)) continue;
    if (r.costDeltaAgorot <= 0) continue;
    const d = r.driver;
    if (!d || d.kind !== 'product' || d.deltaAgorot <= 0 || !d.priceBefore || !d.priceNow) continue;
    const before = parseScaled(d.priceBefore, 4); // ₪ × 10^4
    const now = parseScaled(d.priceNow, 4);
    if (now <= before || before <= 0n) continue;
    out.push({
      recipeId: r.recipeId,
      name: r.name,
      nameEn: r.nameEn,
      beforeFoodCostBp: r.beforeFoodCostBp,
      afterFoodCostBp: r.afterFoodCostBp,
      costDeltaAgorot: r.costDeltaAgorot,
      product: {
        name: d.name,
        nameEn: d.nameEn,
        unit: d.unit,
        priceBefore: d.priceBefore,
        priceNow: d.priceNow,
        priceDeltaAgorot: Number(roundHalfUp((now - before) * 100n, 10_000n)),
        priceChangeBp: Number(roundHalfUp((now - before) * 10_000n, before)),
      },
      supplier: d.supplier,
    });
  }
  return out.sort((a, b) => b.costDeltaAgorot - a.costDeltaAgorot);
}
