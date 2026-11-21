/**
 * W3-02 · the recipe workbench preview: cost a DRAFT recipe (what the chef is
 * typing, not what is saved) against today's prices, with nothing written.
 *
 * The draft replaces the saved recipe of the same id (or joins the set under a
 * synthetic id when it is new), so sub-recipes and cycles resolve exactly as a
 * save would cost them. The ₪ math is `costRecipes` itself — this file only
 * adds the derived numbers the editor shows live: the gap to the target and
 * each line's share of the plate.
 */
import { costLight, costRecipes, type CostLight, type CostRecipe, type LineStatus, type PriceMap } from './cost';

/** The id a brand-new draft is costed under (never a real uuid, never stored). */
export const DRAFT_ID = 'draft';

export interface PreviewLine {
  /** The draft line's position (0-based), so the client maps it back to its row. */
  index: number;
  status: LineStatus;
  /** Integer agorot for one batch (0 when status ≠ ok). */
  costAgorot: number;
  /** This line's share of the batch cost in basis points; the shares sum to exactly 10,000 when the batch cost is > 0. */
  shareBp: number;
}

export interface RecipePreview {
  batchCostAgorot: number;
  portionCostAgorot: number;
  netMenuPriceAgorot: number | null;
  foodCostBp: number | null;
  grossMarginAgorot: number | null;
  targetBp: number;
  /** foodCost − target in bp (positive = above target), or null without a menu price. */
  gapToTargetBp: number | null;
  light: CostLight;
  /** Every line priced. */
  complete: boolean;
  lines: PreviewLine[];
}

/**
 * Split 10,000 bp over non-negative integer weights by the largest-remainder
 * method: every share is floor or ceil of the exact share and they sum to
 * exactly 10,000 (ties go to the earlier line). All zero → all 0.
 */
export function sharesBp(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);
  const T = BigInt(total);
  const exact = weights.map((w) => BigInt(w) * 10_000n);
  const floor = exact.map((e) => e / T);
  const rem = exact.map((e, i) => ({ i, r: e % T }));
  let left = 10_000 - floor.reduce((a, b) => a + Number(b), 0);
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = floor.map(Number);
  for (const { i } of rem) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/**
 * Cost `draft` with the restaurant's saved recipes around it. `saved` must not
 * be mutated; the draft's items get positional ids (`draft:<index>`).
 */
export function previewDraft(
  saved: readonly CostRecipe[],
  draft: Omit<CostRecipe, 'id' | 'items'> & { id?: string; items: Omit<CostRecipe['items'][number], 'id'>[] },
  prices: PriceMap,
  vatBp: bigint,
  targetBp: number,
): RecipePreview {
  const id = draft.id ?? DRAFT_ID;
  const draftRecipe: CostRecipe = {
    ...draft,
    id,
    menuPriceAgorot: draft.isSubRecipe ? null : draft.menuPriceAgorot,
    items: draft.items.map((it, i) => ({ ...it, id: `draft:${i}` })),
  };
  const set = [...saved.filter((r) => r.id !== id), draftRecipe];
  const cost = costRecipes(set, prices, vatBp).get(id)!;
  const byItem = new Map(cost.lines.map((l) => [l.itemId, l] as const));
  const lines = draftRecipe.items.map((it, index) => {
    const l = byItem.get(it.id);
    return { index, status: l?.status ?? ('ok' as LineStatus), costAgorot: l?.costAgorot ?? 0 };
  });
  const shares = sharesBp(lines.map((l) => Math.max(0, l.costAgorot)));
  return {
    batchCostAgorot: cost.batchCostAgorot,
    portionCostAgorot: cost.portionCostAgorot,
    netMenuPriceAgorot: cost.netMenuPriceAgorot,
    foodCostBp: cost.foodCostBp,
    grossMarginAgorot: cost.grossMarginAgorot,
    targetBp,
    gapToTargetBp: draftRecipe.isSubRecipe || cost.foodCostBp == null ? null : cost.foodCostBp - targetBp,
    light: draftRecipe.isSubRecipe ? 'none' : costLight(cost.foodCostBp, targetBp),
    complete: cost.complete,
    lines: lines.map((l, i) => ({ ...l, shareBp: shares[i]! })),
  };
}
