import { z } from 'zod';
import { eq, restaurants, type RestaurantSettings } from '@restomatch/db';
import { memberProcedure, ownerProcedure, router } from '../trpc';

/**
 * Per-restaurant matching-rules editor (Phase 5).
 *
 * The worker reads `restaurants.settings.tolerances` (via resolveTolerances)
 * and `restaurants.settings.approvalThresholds` (via resolveApprovalThresholds),
 * plus `settings.ocrReviewThreshold`. This router is the owner-facing editor for
 * those JSONB knobs — it does a read-modify-write merge scoped to the caller's
 * restaurant so unrelated keys (e.g. baselineWindowDays) survive an update.
 */

/** A non-negative finite number bounded by `max`, used for tolerance/threshold knobs. */
const boundedNonNeg = (max: number) => z.number().finite().nonnegative().max(max);
/** A fraction in [0, 1] (e.g. percent tolerances stored as 0.05 = 5%). */
const fraction = z.number().finite().min(0).max(1);

const TolerancesSchema = z
  .object({
    pricePercent: fraction.optional(),
    priceAbsolute: boundedNonNeg(1_000_000).optional(),
    qtyPercent: fraction.optional(),
    qtyAbsolute: boundedNonNeg(1_000_000).optional(),
    blockPricePercent: fraction.optional(),
  })
  .strict();

const ApprovalThresholdsSchema = z
  .object({
    largeInvoiceWithoutPo: boundedNonNeg(100_000_000).optional(),
    unorderedItemSignificant: boundedNonNeg(100_000_000).optional(),
    cumulativeLargeAmount: boundedNonNeg(100_000_000).optional(),
    cumulativeLargePct: fraction.optional(),
    cumulativeMediumAmountMin: boundedNonNeg(100_000_000).optional(),
    cumulativeMediumPctMin: fraction.optional(),
  })
  .strict();

const UpdateInput = z
  .object({
    tolerances: TolerancesSchema.optional(),
    approvalThresholds: ApprovalThresholdsSchema.optional(),
    ocrReviewThreshold: fraction.optional(),
  })
  .strict();

/** Drop undefined leaf values so a partial patch never blanks an existing knob. */
function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

export const settingsRouter = router({
  /** Current matching-rules settings for the caller's restaurant. */
  get: memberProcedure.query(async ({ ctx }): Promise<RestaurantSettings> => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return row?.settings ?? {};
  }),

  /**
   * Owner-only partial update. Read-modify-write inside the member tx (RLS GUC
   * set) — merges nested tolerances / approvalThresholds key-by-key over the
   * existing JSONB and preserves keys the editor does not touch.
   */
  update: ownerProcedure.input(UpdateInput).mutation(async ({ ctx, input }): Promise<RestaurantSettings> => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    const current: RestaurantSettings = row?.settings ?? {};

    const next: RestaurantSettings = { ...current };
    if (input.tolerances !== undefined) {
      next.tolerances = { ...current.tolerances, ...pruneUndefined(input.tolerances) };
    }
    if (input.approvalThresholds !== undefined) {
      next.approvalThresholds = {
        ...current.approvalThresholds,
        ...pruneUndefined(input.approvalThresholds),
      };
    }
    if (input.ocrReviewThreshold !== undefined) {
      next.ocrReviewThreshold = input.ocrReviewThreshold;
    }

    const [updated] = await ctx.db
      .update(restaurants)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .returning({ settings: restaurants.settings });
    return updated?.settings ?? next;
  }),
});
