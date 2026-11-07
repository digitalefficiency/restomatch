/**
 * "What changed this month" (moved out of routers/recipes.ts for W3-02, at
 * AU-13's request): each recipe costed at the prices in force at the start of
 * the restaurant's calendar month vs now, with the ingredient that moved it most
 * (the "why") and the supplier who charged today's price.
 *
 * `deriveChanges` is PURE (no DB): AU-13's digest builds its dish section from
 * it. `computeChanges` loads the inputs and calls it; recipes.changes,
 * recipes.priceAlerts and the overview card use that.
 */
import type { Database } from '@restomatch/db';
import { startOfDayInTz } from '../lib/time';
import { costLight, costRecipes, diffCosts, parseScaled, type CostRecipe } from './cost';
import {
  earliestPricesFrom,
  latestPrices,
  loadProducts,
  loadRecipes,
  loadSuppliers,
  toCostRecipes,
  type ItemRow,
  type ProductInfo,
  type RecipeRow,
  type RestaurantCostContext,
} from './data';

/** Start of the current calendar month on the restaurant's wall clock. */
export function startOfMonthInTz(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  // Noon UTC on the 1st is the 1st in every zone within ±12h; take its local midnight.
  return startOfDayInTz(new Date(Date.UTC(y, m - 1, 1, 12)), tz);
}

/** A paid price with the supplier who charged it (PriceWithDate fits). */
export interface PaidPrice {
  unitPrice: string;
  unit: string | null;
  supplierId: string;
}

export interface ChangesInput {
  since: Date;
  targetBp: number;
  vatBp: bigint;
  rows: readonly RecipeRow[];
  items: readonly ItemRow[];
  /** Prices in force at `since` (with first-this-month prices as the baseline for new products). */
  before: ReadonlyMap<string, PaidPrice>;
  /** Today's latest paid prices; `supplierId` = who charged it. */
  now: ReadonlyMap<string, PaidPrice>;
  productInfo: ReadonlyMap<string, ProductInfo>;
  supplierInfo: ReadonlyMap<string, { name: string; nameEn: string | null }>;
}

/** Pure: the "what changed this month" rows from already-loaded recipes and prices. */
export function deriveChanges(input: ChangesInput) {
    const { since, rows, items } = input;
    const rc = { targetBp: input.targetBp };
    const costInput: CostRecipe[] = toCostRecipes([...rows], [...items]);
    const nowCosts = costRecipes(costInput, input.now, input.vatBp);
    const all = { rows, items, costInput, prices: input.now, costs: nowCosts };
    const before = input.before;
    const beforeCosts = costRecipes(all.costInput, before, input.vatBp);
    const diffs = diffCosts(all.costInput, beforeCosts, all.costs);
    const byId = new Map(all.rows.map((r) => [r.id, r] as const));
    const itemsById = new Map(all.items.map((i) => [i.id, i] as const));
    const productInfo = input.productInfo;
    const supplierInfo = input.supplierInfo;
    return {
      since,
      targetBp: rc.targetBp,
      /** Active dishes on the menu (0 ⇒ "no recipes yet", never "prices are steady"). */
      activeDishCount: all.rows.filter((r) => r.active && !r.isSubRecipe).length,
      rows: diffs.map((d) => {
        const r = byId.get(d.recipeId)!;
        // The "why": the line whose cost moved most.
        let driver: { itemId: string; deltaAgorot: number } | null = null;
        for (const l of d.after.lines) {
          const b = d.before.lines.find((x) => x.itemId === l.itemId);
          const delta = l.costAgorot - (b?.costAgorot ?? 0);
          if (!driver || Math.abs(delta) > Math.abs(driver.deltaAgorot)) driver = { itemId: l.itemId, deltaAgorot: delta };
        }
        const it = driver ? itemsById.get(driver.itemId) : undefined;
        const prod = it?.productId ? productInfo.get(it.productId) : undefined;
        const sub = it?.subRecipeId ? byId.get(it.subRecipeId) : undefined;
        const priceBefore = it?.productId ? before.get(it.productId)?.unitPrice ?? null : null;
        const priceNow = it?.productId ? all.prices.get(it.productId)?.unitPrice ?? null : null;
        const supplierId = it?.productId ? all.prices.get(it.productId)?.supplierId ?? null : null;
        const supplier = supplierId ? supplierInfo.get(supplierId) ?? null : null;
        // The alert's "why" (dishPriceAlert): the biggest cost rise on a product
        // line whose paid price went up at the same supplier as at the start of
        // the month — never a supplier switch, a recipe edit or a price drop.
        let riser: { itemId: string; productId: string; deltaAgorot: number } | null = null;
        for (const l of d.after.lines) {
          const pid = itemsById.get(l.itemId)?.productId;
          if (!pid) continue;
          const b0 = before.get(pid);
          const n0 = all.prices.get(pid);
          if (!b0 || !n0 || b0.supplierId !== n0.supplierId) continue;
          if (parseScaled(n0.unitPrice, 4) <= parseScaled(b0.unitPrice, 4)) continue;
          const delta = l.costAgorot - (d.before.lines.find((x) => x.itemId === l.itemId)?.costAgorot ?? 0);
          if (delta > 0 && (!riser || delta > riser.deltaAgorot)) riser = { itemId: l.itemId, productId: pid, deltaAgorot: delta };
        }
        const riserProd = riser ? productInfo.get(riser.productId) : undefined;
        const riserSupplierId = riser ? all.prices.get(riser.productId)!.supplierId : null;
        const riserSupplier = riserSupplierId ? supplierInfo.get(riserSupplierId) ?? null : null;
        return {
          recipeId: r.id,
          name: r.name,
          nameEn: r.nameEn,
          isSubRecipe: r.isSubRecipe,
          active: r.active,
          beforeCostAgorot: d.before.portionCostAgorot,
          afterCostAgorot: d.after.portionCostAgorot,
          beforeFoodCostBp: d.before.foodCostBp,
          afterFoodCostBp: d.after.foodCostBp,
          costDeltaAgorot: d.portionCostDeltaAgorot,
          marginDeltaAgorot: d.marginDeltaAgorot,
          afterLight: r.isSubRecipe ? ('none' as const) : costLight(d.after.foodCostBp, rc.targetBp),
          driver: driver && it
            ? {
                kind: it.productId ? ('product' as const) : ('subRecipe' as const),
                name: prod?.name ?? sub?.name ?? '',
                nameEn: prod?.nameEn ?? sub?.nameEn ?? null,
                unit: prod?.unit ?? (it.productId ? all.prices.get(it.productId)?.unit : null) ?? null,
                deltaAgorot: driver.deltaAgorot,
                priceBefore,
                priceNow,
                /** Who charged today's price (the latest paid price's supplier). */
                supplier: supplier ? { id: supplierId!, name: supplier.name, nameEn: supplier.nameEn } : null,
              }
            : null,
          riser: riser
            ? {
                name: riserProd?.name ?? '',
                nameEn: riserProd?.nameEn ?? null,
                unit: riserProd?.unit ?? all.prices.get(riser.productId)?.unit ?? null,
                deltaAgorot: riser.deltaAgorot,
                priceBefore: before.get(riser.productId)!.unitPrice,
                priceNow: all.prices.get(riser.productId)!.unitPrice,
                supplier: riserSupplier ? { id: riserSupplierId!, name: riserSupplier.name, nameEn: riserSupplier.nameEn } : null,
              }
            : null,
        };
      }),
    };
}

/** Load the inputs for `deriveChanges` (RLS-scoped member transaction) and derive. */
export async function computeChanges(db: Database, rid: string, rc: RestaurantCostContext) {
  const { rows, items } = await loadRecipes(db, rid);
  const used = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const now = await latestPrices(db, rid, { productIds: used });
  const since = startOfMonthInTz(new Date(), rc.timezone);
  const productIds = [...now.keys()];
  const before = await latestPrices(db, rid, { before: since, productIds });
  // A product first bought this month has no "before": its first price this month is the baseline.
  const firstThisMonth = await earliestPricesFrom(db, rid, since, productIds);
  for (const [pid, p] of firstThisMonth) if (!before.has(pid) && now.has(pid)) before.set(pid, p);
  const productInfo = await loadProducts(db, rid, productIds);
  const supplierInfo = await loadSuppliers(db, rid, [...new Set([...now.values()].map((p) => p.supplierId))]);
  return deriveChanges({ since, targetBp: rc.targetBp, vatBp: rc.vatBp, rows, items, before, now, productInfo, supplierInfo });
}
