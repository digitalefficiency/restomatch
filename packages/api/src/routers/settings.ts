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

/** A valid IANA timezone (e.g. Asia/Jerusalem) — load-bearing for day boundaries. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'אזור זמן לא תקין' },
  );

/** Restaurant profile patch. vatRate is a fraction (0.17 = 17%). businessId
 *  nullable so it can be cleared. At least one field required. */
const ProfileUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    businessId: z.string().trim().max(32).nullable().optional(),
    vatRate: fraction.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'אין שינויים לעדכן' });

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

  /** Restaurant profile (name / business id / VAT rate / timezone) for the editor. */
  profile: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return {
      name: row?.name ?? '',
      businessId: row?.businessId ?? null,
      // vatRate is NUMERIC → Drizzle returns a string; expose it as a fraction number.
      vatRate: row?.vatRate != null ? Number(row.vatRate) : 0.17,
      timezone: row?.timezone ?? 'Asia/Jerusalem',
    };
  }),

  /**
   * Owner-only profile update. VAT rate and timezone are load-bearing for the
   * leak engine and receiving day-boundaries — this is the in-app path to fix
   * them (previously editable only via a manual DB write).
   */
  updateProfile: ownerProcedure.input(ProfileUpdateInput).mutation(async ({ ctx, input }) => {
    const patch: Partial<typeof restaurants.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.businessId !== undefined) patch.businessId = input.businessId || null;
    if (input.vatRate !== undefined) patch.vatRate = String(input.vatRate);
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const [updated] = await ctx.db
      .update(restaurants)
      .set(patch)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .returning({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      });
    return {
      name: updated?.name ?? '',
      businessId: updated?.businessId ?? null,
      vatRate: updated?.vatRate != null ? Number(updated.vatRate) : 0.17,
      timezone: updated?.timezone ?? 'Asia/Jerusalem',
    };
  }),
});
