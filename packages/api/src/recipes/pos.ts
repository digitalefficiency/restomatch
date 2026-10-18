import { MAX_AMOUNT_AGOROT, parseScaled, roundHalfUp, type RecipeCost } from './cost';

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
  /** Some ingredient has no paid price / a unit problem — the cost is understated. */
  costIncomplete: boolean;
  /** Net sales ≤ 0 or an actual food cost over 200%: POS data to check (refunds, comps,
   *  a mis-keyed price) — never shown as a real gap. */
  implausible: boolean;
}

/** Above this the "actual food cost" is a data problem, not a kitchen problem. */
export const IMPLAUSIBLE_FOOD_COST_BP = 20_000;

export interface PosVsTheory {
  rows: PosDishRow[];
  totals: { netSalesAgorot: number; theoreticalCostAgorot: number; foodCostBp: number | null };
  unmatched: Array<{ itemRef: string; itemName: string; netSalesAgorot: number }>;
}

/**
 * POS exports spell names loosely: NFKC (full-width), bidi/format marks stripped,
 * geresh/gershayim and ASCII quotes dropped (צ"יפס = צ״יפס = ציפס), maqaf/dashes
 * unified with no spaces around them, whitespace (incl. NBSP) collapsed, lowercased.
 */
export function normName(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c\ufeff]/g, '')
    .replace(/["'\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, '')
    .replace(/\s*[-\u05BE\u2010-\u2015]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MAX = MAX_AMOUNT_AGOROT;
const capped = (n: bigint) => (n > MAX || n < -MAX ? null : Number(n));

/**
 * Match a POS item to a dish by its ref or its name against the dish's Hebrew
 * or English name (case/space-insensitive). Sub-recipes are never sold.
 */
export function matchPosItems(items: readonly PosItemSales[], recipes: readonly PosRecipeRef[]): Map<string, PosItemSales[]> {
  // Precedence: an exact primary name, then a normalized primary name, then a
  // normalized English name — a dish's own name never loses to another dish's
  // English name, whatever order the recipes come in.
  const dishes = recipes.filter((r) => !r.isSubRecipe);
  const exact = new Map<string, string>();
  const primary = new Map<string, string>();
  const english = new Map<string, string>();
  for (const r of dishes) {
    if (!exact.has(r.name.trim())) exact.set(r.name.trim(), r.id);
    if (!primary.has(normName(r.name))) primary.set(normName(r.name), r.id);
    if (r.nameEn && !english.has(normName(r.nameEn))) english.set(normName(r.nameEn), r.id);
  }
  const lookup = (s: string) => exact.get(s.trim()) ?? primary.get(normName(s)) ?? english.get(normName(s));
  const out = new Map<string, PosItemSales[]>();
  for (const it of items) {
    const id = lookup(it.itemRef) ?? lookup(it.itemName);
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
  const matchedRefs = new Set<string>();
  const rows: PosDishRow[] = [];
  let totalSales = 0n;
  let totalCost = 0n;
  for (const [recipeId, its] of matched) {
    const cost = costs.get(recipeId);
    if (!cost) continue; // its items stay in `unmatched` — never silently dropped
    for (const i of its) matchedRefs.add(i.itemRef);
    const qty = its.reduce((a, i) => a + parseScaled(i.qty, 3), 0n); // × 1000
    const sales = its.reduce((a, i) => a + parseScaled(i.netAmount, 2), 0n); // agorot
    const portion = BigInt(cost.portionCostAgorot);
    const theoretical = roundHalfUp(portion * qty, 1000n);
    const actualBigBp = sales > 0n ? roundHalfUp(theoretical * 10_000n, sales) : null;
    const actualBp = actualBigBp == null ? null : capped(actualBigBp);
    const implausible = sales <= 0n || actualBp == null || actualBp > IMPLAUSIBLE_FOOD_COST_BP;
    const theoreticalN = capped(theoretical);
    if (theoreticalN == null) continue; // beyond any real menu — keep it out of the totals
    rows.push({
      recipeId,
      itemRefs: its.map((i) => i.itemRef),
      qtySold: Number(qty) / 1000,
      netSalesAgorot: Number(sales),
      avgNetPriceAgorot: qty > 0n ? Number(roundHalfUp(sales * 1000n, qty)) : null,
      portionCostAgorot: cost.portionCostAgorot,
      theoreticalCostAgorot: theoreticalN,
      menuFoodCostBp: cost.foodCostBp,
      actualFoodCostBp: implausible ? null : actualBp,
      gapBp: !implausible && actualBp != null && cost.foodCostBp != null ? actualBp - cost.foodCostBp : null,
      costIncomplete: !cost.complete,
      implausible,
    });
    totalSales += sales;
    totalCost += theoretical;
  }
  rows.sort((a, b) => (b.gapBp ?? -Infinity) - (a.gapBp ?? -Infinity));
  const salesN = capped(totalSales) ?? 0;
  const costN = capped(totalCost) ?? 0;
  const unmatched = items
    .filter((i) => !matchedRefs.has(i.itemRef))
    .map((i) => ({ itemRef: i.itemRef, itemName: i.itemName, netSalesAgorot: Number(parseScaled(i.netAmount, 2)) }))
    .sort((a, b) => b.netSalesAgorot - a.netSalesAgorot);
  return {
    rows,
    totals: {
      netSalesAgorot: salesN,
      theoreticalCostAgorot: costN,
      foodCostBp: totalSales > 0n ? capped(roundHalfUp(totalCost * 10_000n, totalSales)) : null,
    },
    unmatched,
  };
}
