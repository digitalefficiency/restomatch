import { parseScaled, roundHalfUp, type RecipeCost } from './cost';

/**
 * Theoretical vs actual food cost per dish, from POS sales (wave 1; needs both
 * the `recipes` and the `integrations` flags). Pure — the router feeds it the
 * POS aggregate (S5's `integrations.posSummary` shape) and the recipe costs.
 *
 *   theoretical food cost % = portion cost / NET menu price   (what the menu promises)
 *   actual food cost %      = portion cost × units sold / POS net sales
 *                             (what the plates really sold for — discounts, comps,
 *                             happy-hour prices all show up here)
 *   gap                     = actual − theoretical (basis points; > 0 = worse than the menu)
 *
 * Money: POS NUMERIC strings are parsed at the boundary (net amount scale 2 →
 * agorot, qty scale 3), every product is exact BigInt and rounded half-up once.
 * POS `net_amount` is net of VAT, like the menu price the engine nets VAT out of.
 */

export interface PosItemSales {
  itemRef: string;
  itemName: string;
  /** NUMERIC(14,3) string. */
  qty: string;
  /** NUMERIC(14,2) string, shekels, net of VAT. */
  netAmount: string;
}

export interface PosRecipeRef {
  id: string;
  name: string;
  nameEn: string | null;
  isSubRecipe: boolean;
}

export interface PosDishRow {
  recipeId: string;
  /** POS item refs matched to this dish. */
  itemRefs: string[];
  qtySold: number;
  netSalesAgorot: number;
  /** POS net sales / units sold (half-up), or null when nothing was sold. */
  avgNetPriceAgorot: number | null;
  portionCostAgorot: number;
  /** portion cost × units sold (half-up). */
  theoreticalCostAgorot: number;
  menuFoodCostBp: number | null;
  actualFoodCostBp: number | null;
  gapBp: number | null;
}

export interface PosVsTheory {
  rows: PosDishRow[];
  totals: { netSalesAgorot: number; theoreticalCostAgorot: number; foodCostBp: number | null };
  unmatched: Array<{ itemRef: string; itemName: string; netSalesAgorot: number }>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Match a POS item to a dish by its ref or its name against the dish's Hebrew
 * or English name (case/space-insensitive). Sub-recipes are never sold.
 */
export function matchPosItems(items: readonly PosItemSales[], recipes: readonly PosRecipeRef[]): Map<string, PosItemSales[]> {
  const byName = new Map<string, string>();
  for (const r of recipes) {
    if (r.isSubRecipe) continue;
    byName.set(norm(r.name), r.id);
    if (r.nameEn) byName.set(norm(r.nameEn), r.id);
  }
  const out = new Map<string, PosItemSales[]>();
  for (const it of items) {
    const id = byName.get(norm(it.itemRef)) ?? byName.get(norm(it.itemName));
    if (!id) continue;
    out.set(id, [...(out.get(id) ?? []), it]);
  }
  return out;
}

export function posVsTheory(
  items: readonly PosItemSales[],
  recipes: readonly PosRecipeRef[],
  costs: ReadonlyMap<string, RecipeCost>,
): PosVsTheory {
  const matched = matchPosItems(items, recipes);
  const matchedRefs = new Set([...matched.values()].flat().map((i) => i.itemRef));
  const rows: PosDishRow[] = [];
  let totalSales = 0n;
  let totalCost = 0n;
  for (const [recipeId, its] of matched) {
    const cost = costs.get(recipeId);
    if (!cost) continue;
    const qty = its.reduce((a, i) => a + parseScaled(i.qty, 3), 0n); // × 1000
    const sales = its.reduce((a, i) => a + parseScaled(i.netAmount, 2), 0n); // agorot
    const portion = BigInt(cost.portionCostAgorot);
    const theoretical = roundHalfUp(portion * qty, 1000n);
    const actualBp = sales > 0n ? Number(roundHalfUp(theoretical * 10_000n, sales)) : null;
    rows.push({
      recipeId,
      itemRefs: its.map((i) => i.itemRef),
      qtySold: Number(qty) / 1000,
      netSalesAgorot: Number(sales),
      avgNetPriceAgorot: qty > 0n ? Number(roundHalfUp(sales * 1000n, qty)) : null,
      portionCostAgorot: cost.portionCostAgorot,
      theoreticalCostAgorot: Number(theoretical),
      menuFoodCostBp: cost.foodCostBp,
      actualFoodCostBp: actualBp,
      gapBp: actualBp != null && cost.foodCostBp != null ? actualBp - cost.foodCostBp : null,
    });
    totalSales += sales;
    totalCost += theoretical;
  }
  rows.sort((a, b) => (b.gapBp ?? -Infinity) - (a.gapBp ?? -Infinity));
  const unmatched = items
    .filter((i) => !matchedRefs.has(i.itemRef))
    .map((i) => ({ itemRef: i.itemRef, itemName: i.itemName, netSalesAgorot: Number(parseScaled(i.netAmount, 2)) }))
    .sort((a, b) => b.netSalesAgorot - a.netSalesAgorot);
  return {
    rows,
    totals: {
      netSalesAgorot: Number(totalSales),
      theoreticalCostAgorot: Number(totalCost),
      foodCostBp: totalSales > 0n ? Number(roundHalfUp(totalCost * 10_000n, totalSales)) : null,
    },
    unmatched,
  };
}
