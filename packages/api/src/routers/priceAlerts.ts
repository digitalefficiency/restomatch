import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  priceAlertThresholds,
  priceAlerts,
  products,
  sql,
  suppliers,
} from '@restomatch/db';
import { financeProcedure, managerProcedure, router } from '../trpc';
import { assertSupplierOwned } from '../tenant';
import { assertFeatureOn } from '../lib/featureGate';
import { loadAlertDetails, runPriceAlertSweep } from '../priceAlerts/sweep';
import { DEFAULT_THRESHOLD_PCT, DEFAULT_WINDOW_DAYS } from '../priceAlerts/detect';
import {
  loadAlertImpacts,
  previewThresholdCount,
  PRICE_ALERT_T2_FLOOR_ILS,
  PRICE_ALERT_T2_MIN_PCT,
} from '../priceAlerts/impact';
import { DISMISS_REASONS, priceAlertReasonsOn } from '../priceAlerts/reasons';
import { recordAudit, type AuditAction } from '../audit';

/**
 * TODO(G-05): `price_alert.dismissed` / `price_alert.reopened` are on G-05's
 * pre-add list (PR a). Until it merges they are not in the AuditAction union;
 * the only writer is behind PRICE_ALERT_REASONS (default off).
 */
const AUDIT_DISMISSED = 'price_alert.dismissed' as AuditAction;
const AUDIT_REOPENED = 'price_alert.reopened' as AuditAction;

/**
 * Price-trend alerts + per-supplier/category thresholds (wave-1 `priceAlerts`).
 * Reads finance-tier, writes manager-tier; feature-gated; RLS-scoped. The daily
 * worker sweep also emails owners/managers through the notification outbox.
 */
export const priceAlertsRouter = router({
  list: financeProcedure
    .input(z.object({ status: z.enum(['open', 'dismissed']).optional() }).strict().optional())
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      const alerts = await loadAlertDetails(ctx.db, rid, undefined, { status: input?.status ?? 'open' });
      // W2-12 (additive): each alert's ≈₪/month estimate, tone, contract price and 90-day median.
      const impacts = await loadAlertImpacts(ctx.db, rid, alerts);
      return alerts.map((a) => ({ ...a, impact: impacts.get(a.id)! }));
    }),

  /**
   * Dismiss an alert. W2-12: an optional reason chip, recorded in the audit
   * log only while PRICE_ALERT_REASONS is on (no reason column — H-04). The UI
   * offers a 10 s undo through `reopen`.
   */
  dismiss: managerProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.enum(DISMISS_REASONS).optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      const [row] = await ctx.db
        .update(priceAlerts)
        .set({ status: 'dismissed', dismissedAt: new Date(), dismissedBy: ctx.session.userId })
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.restaurantId, rid)))
        .returning({ id: priceAlerts.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'price alert not found' });
      if (priceAlertReasonsOn() && input.reason) {
        await recordAudit(ctx.db, {
          restaurantId: rid,
          userId: ctx.session.userId,
          action: AUDIT_DISMISSED,
          entityType: 'price_alert',
          entityId: row.id,
          after: { status: 'dismissed', reason: input.reason },
        });
      }
      return { ok: true as const };
    }),

  /** Undo a dismiss (W2-12's 10 s undo, and the dismissed list's "reopen"). Manager tier. */
  reopen: managerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      const [row] = await ctx.db
        .update(priceAlerts)
        .set({ status: 'open', dismissedAt: null, dismissedBy: null })
        .where(and(eq(priceAlerts.id, input.id), eq(priceAlerts.restaurantId, rid), eq(priceAlerts.status, 'dismissed')))
        .returning({ id: priceAlerts.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'price alert not found' });
      if (priceAlertReasonsOn()) {
        await recordAudit(ctx.db, {
          restaurantId: rid,
          userId: ctx.session.userId,
          action: AUDIT_REOPENED,
          entityType: 'price_alert',
          entityId: row.id,
          after: { status: 'open' },
        });
      }
      return { ok: true as const };
    }),

  /**
   * Live preview for the threshold editor: how many (product, supplier) series
   * would have alerted in the last 90 days under the candidate rule. Finance
   * tier, read-only — writes nothing.
   */
  previewThreshold: financeProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid().nullable(),
          category: z.string().trim().min(1).max(100).nullable(),
          thresholdPct: z.number().gt(0).max(5),
          windowDays: z.number().int().min(7).max(120),
        })
        .strict(),
    )
    .query(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      if (input.supplierId) await assertSupplierOwned(ctx.db, input.supplierId, rid);
      return previewThresholdCount(ctx.db, rid, input);
    }),

  /** Re-run detection now for this restaurant (in-app only; the cron emails). */
  refresh: managerProcedure.mutation(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    await assertFeatureOn(ctx.db, rid, 'priceAlerts');
    const res = await runPriceAlertSweep(ctx.db, rid, { notify: false });
    return { created: res.created };
  }),

  /** Threshold rules + the categories that can be targeted + the built-in default. */
  thresholds: financeProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    await assertFeatureOn(ctx.db, rid, 'priceAlerts');
    const rules = await ctx.db
      .select({
        id: priceAlertThresholds.id,
        supplierId: priceAlertThresholds.supplierId,
        supplierName: suppliers.name,
        category: priceAlertThresholds.category,
        thresholdPct: priceAlertThresholds.thresholdPct,
        windowDays: priceAlertThresholds.windowDays,
        enabled: priceAlertThresholds.enabled,
      })
      .from(priceAlertThresholds)
      .leftJoin(suppliers, eq(suppliers.id, priceAlertThresholds.supplierId))
      .where(eq(priceAlertThresholds.restaurantId, rid))
      .orderBy(asc(priceAlertThresholds.createdAt));
    const cats = await ctx.db
      .selectDistinct({ category: products.category })
      .from(products)
      .where(and(eq(products.restaurantId, rid), isNotNull(products.category)))
      .orderBy(asc(products.category));
    return {
      rules: rules.map((r) => ({ ...r, thresholdPct: Number(r.thresholdPct) })),
      categories: cats.map((c) => c.category!).filter(Boolean),
      defaults: { thresholdPct: DEFAULT_THRESHOLD_PCT, windowDays: DEFAULT_WINDOW_DAYS },
      // W2-12: the act-now (T2) rule, read-only in the UI (a per-rule ₪ column is H-04).
      t2: { minPct: PRICE_ALERT_T2_MIN_PCT, floorIls: PRICE_ALERT_T2_FLOOR_ILS },
    };
  }),

  /** Create or replace the rule for a scope (supplier and/or category; both null = default). */
  setThreshold: managerProcedure
    .input(
      z
        .object({
          supplierId: z.string().uuid().nullable(),
          category: z.string().trim().min(1).max(100).nullable(),
          thresholdPct: z.number().gt(0).max(5),
          windowDays: z.number().int().min(7).max(120),
          enabled: z.boolean().default(true),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      if (input.supplierId) await assertSupplierOwned(ctx.db, input.supplierId, rid);
      const scope = and(
        eq(priceAlertThresholds.restaurantId, rid),
        input.supplierId ? eq(priceAlertThresholds.supplierId, input.supplierId) : isNull(priceAlertThresholds.supplierId),
        input.category ? eq(priceAlertThresholds.category, input.category) : isNull(priceAlertThresholds.category),
      );
      const values = {
        thresholdPct: input.thresholdPct.toFixed(4),
        windowDays: input.windowDays,
        enabled: input.enabled,
      };
      const [existing] = await ctx.db
        .select({ id: priceAlertThresholds.id })
        .from(priceAlertThresholds)
        .where(scope)
        .limit(1)
        .for('update');
      if (existing) {
        await ctx.db.update(priceAlertThresholds).set(values).where(eq(priceAlertThresholds.id, existing.id));
        return { id: existing.id };
      }
      const [row] = await ctx.db
        .insert(priceAlertThresholds)
        .values({ restaurantId: rid, supplierId: input.supplierId, category: input.category, ...values })
        .returning({ id: priceAlertThresholds.id });
      return { id: row!.id };
    }),

  deleteThreshold: managerProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const rid = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, rid, 'priceAlerts');
      const deleted = await ctx.db
        .delete(priceAlertThresholds)
        .where(and(eq(priceAlertThresholds.id, input.id), eq(priceAlertThresholds.restaurantId, rid)))
        .returning({ id: priceAlertThresholds.id });
      if (deleted.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'threshold not found' });
      return { ok: true as const };
    }),

  /** Open-alert count for the nav/overview badge (cheap). */
  openCount: financeProcedure.query(async ({ ctx }) => {
    const rid = ctx.session.restaurantId;
    await assertFeatureOn(ctx.db, rid, 'priceAlerts');
    const [r] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.restaurantId, rid), eq(priceAlerts.status, 'open')));
    return { count: r?.n ?? 0 };
  }),
});
