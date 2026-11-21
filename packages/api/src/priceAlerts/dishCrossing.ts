import { and, auditLog, eq, type Database } from '@restomatch/db';
import { dishPriceAlerts, type ChangeRowLike, type DishPriceAlert } from '../recipes/alerts';
import { computeChanges } from '../recipes/changes';
import { loadRestaurant } from '../recipes/data';
import type { DishLine } from './digest';

/**
 * AU-13 AC 3 — dishes whose food cost crossed the target this month, pushed to
 * the chef (dish section only), the owner and the manager in the 07:00 slot.
 *
 * Uses the pure `dishPriceAlerts(rows, targetBp)` (recipes/alerts.ts, read only)
 * over the rows of W3-02's `computeChanges` (recipes/changes.ts, read only) —
 * the same rows and target `recipes.priceAlerts` shows in-app, so the mail and
 * the recipes page always agree. The sweep never re-derives recipe costs itself.
 * Every loader behind `computeChanges` filters on restaurant_id explicitly, so
 * it is safe on the worker's service connection (no RLS session).
 *
 * Once per dish per month: audit `prices.dish_crossing_notified` with
 * `{ recipeId, month: 'YYYY-MM' }`.
 */
export const DISH_CROSSING_AUDIT = 'prices.dish_crossing_notified';

export type DishChangesSource = (
  db: Database,
  restaurantId: string,
  now: Date,
) => Promise<{ rows: ChangeRowLike[]; targetBp: number } | null>;

/** W3-02's `computeChanges` with the restaurant's own target (`settings.recipes.targetFoodCostBp`). */
export const DISH_CHANGES_SOURCE: DishChangesSource = async (db, restaurantId) => {
  const rc = await loadRestaurant(db, restaurantId);
  const ch = await computeChanges(db, restaurantId, rc);
  return { rows: ch.rows, targetBp: ch.targetBp };
};

export function toDishLine(a: DishPriceAlert, targetBp: number): DishLine {
  return {
    recipeId: a.recipeId,
    name: a.name,
    afterFoodCostBp: a.afterFoodCostBp,
    targetBp,
    costDeltaAgorot: a.costDeltaAgorot,
    productName: a.product.name,
    productChangeBp: a.product.priceChangeBp,
    supplierName: a.supplier?.name ?? null,
  };
}

/** Dishes that crossed this month and were not announced yet this month. */
export async function pendingDishCrossings(
  db: Database,
  restaurantId: string,
  now: Date,
  month: string,
  source: DishChangesSource | null = DISH_CHANGES_SOURCE,
): Promise<DishLine[]> {
  if (!source) return [];
  const data = await source(db, restaurantId, now);
  if (!data) return [];
  const crossed = dishPriceAlerts(data.rows, data.targetBp);
  if (crossed.length === 0) return [];
  const announced = new Set(
    (
      await db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, DISH_CROSSING_AUDIT)))
    )
      .map((r) => r.after as { recipeId?: string; month?: string } | null)
      .filter((a) => a?.month === month)
      .map((a) => a!.recipeId ?? ''),
  );
  return crossed.filter((c) => !announced.has(c.recipeId)).map((c) => toDishLine(c, data.targetBp));
}

export async function markDishesAnnounced(db: Database, restaurantId: string, month: string, dishes: readonly DishLine[]): Promise<void> {
  if (dishes.length === 0) return;
  await db.insert(auditLog).values(
    dishes.map((d) => ({
      restaurantId,
      userId: null,
      action: DISH_CROSSING_AUDIT,
      entityType: 'recipe',
      entityId: d.recipeId,
      after: { recipeId: d.recipeId, month, kpi: 'A18' } as never,
    })),
  );
}
