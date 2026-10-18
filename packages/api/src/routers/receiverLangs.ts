import { and, eq, memberships } from '@restomatch/db';
import { TARGET_LOCALES } from '@restomatch/translate';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { appError } from '../errors';
import { assertFeature, isFeatureOn } from '../lib/featureGate';
import { localNames } from '../receiving/localize';
import { managerProcedure, memberProcedure, router } from '../trpc';

/**
 * Receiver languages (wave 1, flag `receiverLanguages`): Arabic, Russian,
 * Thai, Tigrinya for the receiver experience. Every procedure runs under RLS
 * (member transaction) and, except `status`, is FORBIDDEN / FEATURE_DISABLED
 * while the flag is off for the session restaurant.
 */
const receiverLocale = z.enum(TARGET_LOCALES);
/** A member's app language may be any UI locale once the flag is on. */
const appLocale = z.enum(['he', 'en', ...TARGET_LOCALES]);

export const receiverLangsRouter = router({
  /** Is the feature on for my restaurant? (drives the picker + getAppLocale). */
  status: memberProcedure.query(async ({ ctx }) => {
    const enabled = await isFeatureOn(ctx.db, ctx.session.restaurantId, 'receiverLanguages');
    return { enabled, locales: enabled ? [...TARGET_LOCALES] : [] };
  }),

  /**
   * Localized names (Hebrew → ar/ru/th/ti) of one PO's and/or one invoice's
   * lines and products. Tenant-guarded (foreign ids → NOT_FOUND); cached per
   * restaurant + locale; Claude only within the per-restaurant hourly budget.
   */
  localNames: memberProcedure
    .input(
      z
        .object({
          locale: receiverLocale,
          poId: z.string().uuid().optional(),
          invoiceId: z.string().uuid().optional(),
        })
        .refine((v) => Boolean(v.poId) || Boolean(v.invoiceId), { message: 'poId or invoiceId is required' }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertFeature(ctx.db, ctx.session.restaurantId, 'receiverLanguages');
      return localNames(ctx.db, ctx.session.restaurantId, input, input.locale);
    }),

  /** Any member sets their OWN language, including a receiver language (self only). */
  setMyLocale: memberProcedure
    .input(z.object({ locale: appLocale.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertFeature(ctx.db, ctx.session.restaurantId, 'receiverLanguages');
      await ctx.db
        .update(memberships)
        .set({ preferredLocale: input.locale })
        .where(
          and(eq(memberships.restaurantId, ctx.session.restaurantId), eq(memberships.userId, ctx.session.userId)),
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
   * Owner/manager sets a member's language (e.g. a Thai-speaking receiver).
   * Scoped to the caller's restaurant: a foreign userId matches nothing → NOT_FOUND.
   */
  setMemberLocale: managerProcedure
    .input(z.object({ userId: z.string().uuid(), locale: appLocale.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertFeature(ctx.db, ctx.session.restaurantId, 'receiverLanguages');
      const updated = await ctx.db
        .update(memberships)
        .set({ preferredLocale: input.locale })
        .where(and(eq(memberships.restaurantId, ctx.session.restaurantId), eq(memberships.userId, input.userId)))
        .returning({ userId: memberships.userId });
      if (updated.length === 0) throw appError('NOT_FOUND', 'team.memberNotFound', 'החבר לא נמצא.');
      await recordAudit(ctx.db, {
        restaurantId: ctx.session.restaurantId,
        userId: ctx.session.userId,
        action: 'team.member_locale_changed',
        entityType: 'user',
        entityId: input.userId,
        after: { locale: input.locale },
      });
      return { userId: input.userId, locale: input.locale };
    }),
});
