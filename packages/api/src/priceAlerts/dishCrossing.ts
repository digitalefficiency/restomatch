import { and, auditLog, eq, type Database } from '@restomatch/db';
import { dishPriceAlerts, type ChangeRowLike, type DishPriceAlert } from '../recipes/alerts';
import type { DishLine } from './digest';

/**
 * AU-13 AC 3 — dishes whose food cost crossed the target this month, pushed to
 * the chef (dish section only), the owner and the manager in the 07:00 slot.
 *
 * Uses the pure `dishPriceAlerts(rows, targetBp)` (recipes/alerts.ts, read only).
 * Its input rows come from `computeChanges`, which today is PRIVATE to
 * `routers/recipes.ts` (W3-02's file). Until W3-02 exports it (requested:
 * `recipes/changes.ts`, no behaviour change), `DISH_CHANGES_SOURCE` is null and
 * the section is omitted — the sweep never re-derives recipe costs itself.
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

/** Adoption point for W3-02's exported `computeChanges` seam (one line). */
export const DISH_CHANGES_SOURCE: DishChangesSource | null = null;

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
