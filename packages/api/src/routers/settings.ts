import { z } from 'zod';
import {
  and,
  auditLog,
  desc,
  eq,
  inArray,
  memberships,
  restaurants,
  users,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { resolveTolerances } from '@restomatch/matching';
import { DEFAULT_REVIEW_THRESHOLD } from '@restomatch/ocr';
import { resolveApprovalThresholds } from '../approvals/engine';
import { recordAudit, type AuditAction } from '../audit';
import { appError } from '../errors';
import { financeProcedure, memberProcedure, ownerProcedure, router } from '../trpc';
import { hasNoControlChars, NO_CONTROL_CHARS_MESSAGE } from '../lib/text';

/**
 * W2-14 audit actions. G-05 pre-adds them to the `AuditAction` union
 * (`claude/ux-g-05-write-kernel`); until it is on main they are cast here.
 * TODO(W2-14 rebase): drop the casts once G-05 merges.
 */
const SETTINGS_UPDATED = 'settings.updated' as AuditAction;
const SETTINGS_PROFILE_UPDATED = 'settings.profile_updated' as AuditAction;
const SETTINGS_ACTIONS = [SETTINGS_UPDATED, SETTINGS_PROFILE_UPDATED] as const;

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
/** A knob value, or `null` = remove the override and fall back to the engine default. */
const knob = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

const TolerancesSchema = z
  .object({
    pricePercent: knob(fraction),
    priceAbsolute: knob(boundedNonNeg(1_000_000)),
    qtyPercent: knob(fraction),
    qtyAbsolute: knob(boundedNonNeg(1_000_000)),
    blockPricePercent: knob(fraction),
  })
  .strict();

const ApprovalThresholdsSchema = z
  .object({
    largeInvoiceWithoutPo: knob(boundedNonNeg(100_000_000)),
    unorderedItemSignificant: knob(boundedNonNeg(100_000_000)),
    cumulativeLargeAmount: knob(boundedNonNeg(100_000_000)),
    cumulativeLargePct: knob(fraction),
    cumulativeMediumAmountMin: knob(boundedNonNeg(100_000_000)),
    cumulativeMediumPctMin: knob(fraction),
  })
  .strict();

const UpdateInput = z
  .object({
    tolerances: TolerancesSchema.optional(),
    approvalThresholds: ApprovalThresholdsSchema.optional(),
    ocrReviewThreshold: knob(fraction),
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
    { message: 'אזור זמן לא תקין', params: { appCode: 'settings.invalidTimezone' } },
  );

/** Restaurant profile patch. vatRate is a fraction (0.17 = 17%). businessId
 *  nullable so it can be cleared. At least one field required. */
const ProfileUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(200).refine(hasNoControlChars, NO_CONTROL_CHARS_MESSAGE).optional(),
    businessId: z.string().trim().max(32).nullable().optional(),
    vatRate: fraction.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'אין שינויים לעדכן', params: { appCode: 'settings.noChanges' } });

/**
 * Merge a partial patch over the stored knobs. `undefined` leaves a knob alone;
 * `null` DELETES the key (restores the engine default). Writing `null` would not
 * do: `resolve*` would still see the key, so the key must be gone.
 */
function mergeKnobs<T extends Record<string, number | undefined>>(
  current: T | undefined,
  patch: Record<string, number | null | undefined>,
): T {
  const out: Record<string, number | undefined> = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

export interface EffectiveValue {
  value: number;
  /** true = no override stored, the engine default is in force. */
  isDefault: boolean;
}

/**
 * The values the engine ACTUALLY enforces for a settings blob: the stored
 * override, else the default. Defaults come from the engine's own resolvers
 * (`resolveTolerances`, `resolveApprovalThresholds`, `DEFAULT_REVIEW_THRESHOLD`)
 * and are never redefined here.
 */
export function effectiveSettings(settings: RestaurantSettings) {
  const tol = resolveTolerances(settings.tolerances);
  const appr = resolveApprovalThresholds(settings.approvalThresholds);
  const pick = <T extends Record<string, number>>(resolved: T, stored: Partial<T> | undefined) =>
    Object.fromEntries(
      Object.entries(resolved).map(([k, value]) => [
        k,
        { value, isDefault: stored?.[k as keyof T] == null } satisfies EffectiveValue,
      ]),
    ) as { [K in keyof T]: EffectiveValue };
  return {
    tolerances: pick(tol, settings.tolerances),
    approvalThresholds: pick(appr, settings.approvalThresholds),
    ocrReviewThreshold: {
      value: settings.ocrReviewThreshold ?? DEFAULT_REVIEW_THRESHOLD,
      isDefault: settings.ocrReviewThreshold == null,
    } satisfies EffectiveValue,
  };
}

/**
 * Normalise an Israeli phone number to E.164 (+972…). Accepts local forms
 * ("050-123 4567", "03-1234567") and international ones ("+972 50…", "00972…").
 * Returns null when it is not a plausible Israeli number (8–9 national digits).
 */
export function normalizeIlPhone(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  if (!/^972\d+$/.test(d)) return null;
  const national = d.slice(3).replace(/^0/, '');
  if (!/^[2-9]\d{7,8}$/.test(national)) return null;
  return `+972${national}`;
}

/** Owner/admin connection: `users` is REVOKE'd from the tenant app role (rls.ts). */
function adminConn(ctx: { adminDb?: Database; db: Database }): Database {
  return ctx.adminDb ?? ctx.db;
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
      next.tolerances = mergeKnobs(current.tolerances, input.tolerances);
    }
    if (input.approvalThresholds !== undefined) {
      next.approvalThresholds = mergeKnobs(current.approvalThresholds, input.approvalThresholds);
    }
    if (input.ocrReviewThreshold === null) {
      delete next.ocrReviewThreshold;
    } else if (input.ocrReviewThreshold !== undefined) {
      next.ocrReviewThreshold = input.ocrReviewThreshold;
    }

    const [updated] = await ctx.db
      .update(restaurants)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .returning({ settings: restaurants.settings });
    await recordAudit(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId,
      action: SETTINGS_UPDATED,
      entityType: 'restaurant',
      entityId: ctx.session.restaurantId,
      before: {
        tolerances: current.tolerances ?? {},
        approvalThresholds: current.approvalThresholds ?? {},
        ocrReviewThreshold: current.ocrReviewThreshold ?? null,
      },
      after: {
        tolerances: next.tolerances ?? {},
        approvalThresholds: next.approvalThresholds ?? {},
        ocrReviewThreshold: next.ocrReviewThreshold ?? null,
      },
    });
    return updated?.settings ?? next;
  }),

  /**
   * The rules in force, per knob: `{ value, isDefault }`. Read-only, any member
   * (the same tier as `get`). The UI shows a "ברירת מחדל" / "הותאם" chip and one
   * rule sentence per group from this, so a blank input never hides a ₪ rule.
   */
  effective: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    return effectiveSettings(row?.settings ?? {});
  }),

  /**
   * Change history of the restaurant's rules and profile (audit rows written by
   * `update` / `updateProfile`), newest first. Finance tier (owner, manager,
   * bookkeeper): the same roles that see the settings sections.
   */
  history: financeProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          at: auditLog.at,
          before: auditLog.before,
          after: auditLog.after,
          userId: auditLog.userId,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.restaurantId, ctx.session.restaurantId),
            inArray(auditLog.action, [...SETTINGS_ACTIONS]),
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(input?.limit ?? 30);
      // Names live in `users` (off-limits to the app role): read them on the
      // owner connection, only for the ids this tenant's own audit rows name.
      const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
      const names = ids.length
        ? await adminConn(ctx)
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(inArray(users.id, ids))
        : [];
      const byId = new Map(names.map((u) => [u.id, u.name || u.email]));
      return rows.map((r) => ({
        id: r.id,
        kind: r.action === SETTINGS_UPDATED ? ('rules' as const) : ('profile' as const),
        at: r.at,
        byName: r.userId ? (byId.get(r.userId) ?? null) : null,
        before: r.before as Record<string, unknown> | null,
        after: r.after as Record<string, unknown> | null,
      }));
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

    const [prev] = await ctx.db
      .select({
        name: restaurants.name,
        businessId: restaurants.businessId,
        vatRate: restaurants.vatRate,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);

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
    // Only the fields the patch touched, before and after.
    const touched = (['name', 'businessId', 'vatRate', 'timezone'] as const).filter((k) => input[k] !== undefined);
    await recordAudit(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId,
      action: SETTINGS_PROFILE_UPDATED,
      entityType: 'restaurant',
      entityId: ctx.session.restaurantId,
      before: Object.fromEntries(touched.map((k) => [k, prev?.[k] ?? null])),
      after: Object.fromEntries(touched.map((k) => [k, updated?.[k] ?? null])),
    });
    return {
      name: updated?.name ?? '',
      businessId: updated?.businessId ?? null,
      vatRate: updated?.vatRate != null ? Number(updated.vatRate) : 0.17,
      timezone: updated?.timezone ?? 'Asia/Jerusalem',
    };
  }),

  /**
   * The caller's own app language on the active restaurant (memberships.
   * preferred_locale, 0028). NULL = no preference (device cookie / Hebrew).
   */
  myLocale: memberProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ locale: memberships.preferredLocale })
      .from(memberships)
      .where(
        and(
          eq(memberships.restaurantId, ctx.session.restaurantId),
          eq(memberships.userId, ctx.session.userId),
        ),
      )
      .limit(1);
    const locale = row?.locale;
    // Receiver languages (S14, 0052) pass through; the web gates them by the flag.
    return {
      locale:
        locale === 'he' || locale === 'en' || locale === 'ar' || locale === 'ru' || locale === 'th' || locale === 'ti'
          ? locale
          : null,
    };
  }),

  /** Any member sets their OWN app language (self only — keyed by the session). */
  setMyLocale: memberProcedure
    .input(z.object({ locale: z.enum(['he', 'en']).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(memberships)
        .set({ preferredLocale: input.locale })
        .where(
          and(
            eq(memberships.restaurantId, ctx.session.restaurantId),
            eq(memberships.userId, ctx.session.userId),
          ),
        );
      await recordAudit(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'settings.my_locale_changed',
        entityType: 'user',
        entityId: ctx.session.userId,
        after: { locale: input.locale },
      });
      return { locale: input.locale };
    }),

  /**
   * The caller's own phone (users.phone) and whether it is verified. Verification
   * is not live yet: `users.phone_verified_at` arrives with G-03 (deploy Tue
   * 24.11) and OTP sending needs a WhatsApp/SMS provider (Phase-6), so
   * `verified` is false and `verificationAvailable` is false until then.
   */
  myPhone: memberProcedure.query(async ({ ctx }) => {
    const [row] = await adminConn(ctx)
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, ctx.session.userId))
      .limit(1);
    return { phone: row?.phone ?? null, verified: false, verificationAvailable: false };
  }),

  /**
   * Self only: set (or clear, with null) the caller's phone, normalised to E.164
   * (+972…). `users` is REVOKE'd from the tenant app role, so this writes on the
   * auth/owner connection, scoped `WHERE id = session.userId` and nothing else.
   * The number is stored UNVERIFIED (interim until G-03's phone_verified_at).
   */
  setMyPhone: memberProcedure
    .input(z.object({ phone: z.string().trim().max(32).nullable() }))
    .mutation(async ({ ctx, input }) => {
      let phone: string | null = null;
      if (input.phone) {
        phone = normalizeIlPhone(input.phone);
        if (!phone) throw appError('BAD_REQUEST', 'input.invalid', 'מספר טלפון לא תקין');
      }
      await adminConn(ctx)
        .update(users)
        .set({ phone, updatedAt: new Date() })
        .where(eq(users.id, ctx.session.userId));
      return { phone, verified: false };
    }),
});
