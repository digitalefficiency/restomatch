import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notificationsOutbox,
  or,
  poLines,
  priceBaselines,
  purchaseOrders,
  restaurants,
  suppliers,
  supplierCatalogItems,
  type Database,
} from '@restomatch/db';
import { managerProcedure, memberProcedure, requireFeature, router } from '../trpc';
import { assertPoOwned, assertSupplierOwned } from '../tenant';
import { getEntitlements } from '../entitlements';

const DEFAULT_BASELINE_WINDOW_DAYS = 90;
/** % over the 90-day median at which we surface an "elevated price" warning. */
const ELEVATED_PCT = 0.05;

const LineInput = z
  .object({
    productId: z.string().uuid().optional(),
    rawDescription: z.string().trim().max(400).optional(),
    qty: z.number().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(32),
    unitPriceExpected: z.number().nonnegative().max(10_000_000).optional(),
  })
  .strict()
  .refine((l) => !!l.productId || !!l.rawDescription, {
    message: 'line needs a product or a description',
  });

export interface GuardrailWarning {
  productId: string;
  unitPrice: number;
  p50: number;
  p90: number;
  pctOverMedian: number;
  level: 'elevated' | 'high';
}

/**
 * Order-time leak guardrail: compare each line's price to the restaurant's
 * 90-day price baselines (supplier-specific preferred over global) and flag
 * lines priced above the median / 90th percentile — so the owner is warned
 * BEFORE over-ordering, not after the invoice lands.
 */
async function computeGuardrail(
  db: Database,
  restaurantId: string,
  supplierId: string,
  lines: Array<{ productId?: string; unitPriceExpected?: number }>,
  windowDays: number,
): Promise<GuardrailWarning[]> {
  const priced = lines.filter(
    (l): l is { productId: string; unitPriceExpected: number } =>
      !!l.productId && typeof l.unitPriceExpected === 'number',
  );
  if (priced.length === 0) return [];
  const productIds = [...new Set(priced.map((l) => l.productId))];
  const rows = await db
    .select({
      productId: priceBaselines.productId,
      supplierId: priceBaselines.supplierId,
      p50: priceBaselines.p50,
      p90: priceBaselines.p90,
    })
    .from(priceBaselines)
    .where(
      and(
        eq(priceBaselines.restaurantId, restaurantId),
        inArray(priceBaselines.productId, productIds),
        eq(priceBaselines.windowDays, windowDays),
        or(eq(priceBaselines.supplierId, supplierId), isNull(priceBaselines.supplierId)),
      ),
    );
  const baselineByProduct = new Map<string, { p50: number; p90: number }>();
  for (const r of rows) {
    if (r.p50 == null || r.p90 == null) continue;
    const supplierSpecific = r.supplierId != null;
    if (!baselineByProduct.has(r.productId) || supplierSpecific) {
      baselineByProduct.set(r.productId, { p50: Number(r.p50), p90: Number(r.p90) });
    }
  }
  const warnings: GuardrailWarning[] = [];
  for (const l of priced) {
    const b = baselineByProduct.get(l.productId);
    if (!b || b.p50 <= 0) continue;
    const pctOverMedian = (l.unitPriceExpected - b.p50) / b.p50;
    if (l.unitPriceExpected > b.p90) {
      warnings.push({ productId: l.productId, unitPrice: l.unitPriceExpected, p50: b.p50, p90: b.p90, pctOverMedian, level: 'high' });
    } else if (pctOverMedian > ELEVATED_PCT) {
      warnings.push({ productId: l.productId, unitPrice: l.unitPriceExpected, p50: b.p50, p90: b.p90, pctOverMedian, level: 'elevated' });
    }
  }
  return warnings;
}

async function baselineWindow(db: Database, restaurantId: string): Promise<number> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return r?.settings?.baselineWindowDays ?? DEFAULT_BASELINE_WINDOW_DAYS;
}

function lineTotalsEstimated(
  lines: Array<{ qty: number; unitPriceExpected?: number }>,
): string | null {
  let total = 0;
  let any = false;
  for (const l of lines) {
    if (typeof l.unitPriceExpected === 'number') {
      total += l.qty * l.unitPriceExpected;
      any = true;
    }
  }
  return any ? total.toFixed(2) : null;
}

export const ordersRouter = router({
  /** Purchase orders for the restaurant, with supplier name + line count. */
  list: memberProcedure
    .input(
      z
        .object({
          status: z
            .enum(['draft', 'sent', 'confirmed', 'partial', 'closed', 'cancelled'])
            .optional(),
          supplierId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const conds = [eq(purchaseOrders.restaurantId, restaurantId)];
      if (input?.status) conds.push(eq(purchaseOrders.status, input.status));
      if (input?.supplierId) conds.push(eq(purchaseOrders.supplierId, input.supplierId));
      return ctx.db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          status: purchaseOrders.status,
          expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
          totalEstimated: purchaseOrders.totalEstimated,
          sentAt: purchaseOrders.sentAt,
          createdAt: purchaseOrders.createdAt,
          lineCount: count(poLines.id),
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(poLines, eq(poLines.poId, purchaseOrders.id))
        .where(and(...conds))
        .groupBy(purchaseOrders.id, suppliers.name)
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
    }),

  get: memberProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      const [po] = await ctx.db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.poId))
        .limit(1);
      const lines = await ctx.db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(asc(poLines.id));
      return { po, lines };
    }),

  createDraft: managerProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        expectedDeliveryAt: z.date().optional(),
        notes: z.string().trim().max(2000).optional(),
        lines: z.array(LineInput).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);

      // Pre-fill missing unit prices from the supplier's catalog list price.
      const productIds = input.lines
        .map((l) => l.productId)
        .filter((id): id is string => !!id);
      const priceByProduct = new Map<string, string>();
      if (productIds.length > 0) {
        const catRows = await ctx.db
          .select({ productId: supplierCatalogItems.productId, listPrice: supplierCatalogItems.listPrice })
          .from(supplierCatalogItems)
          .where(
            and(
              eq(supplierCatalogItems.restaurantId, restaurantId),
              eq(supplierCatalogItems.supplierId, input.supplierId),
              inArray(supplierCatalogItems.productId, productIds),
            ),
          );
        for (const r of catRows) {
          if (r.productId && r.listPrice != null) priceByProduct.set(r.productId, r.listPrice);
        }
      }

      const resolvedLines = input.lines.map((l) => {
        const fromCatalog =
          l.unitPriceExpected == null && l.productId ? priceByProduct.get(l.productId) : undefined;
        const unitPriceExpected =
          l.unitPriceExpected != null ? l.unitPriceExpected.toString() : (fromCatalog ?? null);
        return { ...l, unitPriceExpected };
      });

      const totalEstimated = lineTotalsEstimated(
        resolvedLines.map((l) => ({
          qty: l.qty,
          unitPriceExpected: l.unitPriceExpected == null ? undefined : Number(l.unitPriceExpected),
        })),
      );

      const [po] = await ctx.db
        .insert(purchaseOrders)
        .values({
          restaurantId,
          supplierId: input.supplierId,
          status: 'draft',
          source: 'manual',
          expectedDeliveryAt: input.expectedDeliveryAt ?? null,
          totalEstimated,
          notes: input.notes ?? null,
          createdBy: ctx.session.userId,
        })
        .returning({ id: purchaseOrders.id });
      if (!po) throw new Error('failed to create purchase order');

      await ctx.db.insert(poLines).values(
        resolvedLines.map((l) => ({
          poId: po.id,
          productId: l.productId ?? null,
          rawDescription: l.rawDescription ?? null,
          qtyOrdered: l.qty.toString(),
          unit: l.unit,
          unitPriceExpected: l.unitPriceExpected,
        })),
      );
      return { poId: po.id };
    }),

  cancelOrder: managerProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      await ctx.db
        .update(purchaseOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.restaurantId, restaurantId)));
      return { ok: true };
    }),

  /** Place a draft PO: transition draft → sent, enqueue an order document to the outbox. */
  placeOrder: managerProcedure
    .input(z.object({ poId: z.string().uuid(), channel: z.enum(['email', 'whatsapp', 'none']) }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);

      const [po] = await ctx.db
        .select({ id: purchaseOrders.id, status: purchaseOrders.status, supplierId: purchaseOrders.supplierId, expectedDeliveryAt: purchaseOrders.expectedDeliveryAt })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.poId))
        .limit(1);
      if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      if (po.status !== 'draft') {
        throw new TRPCError({ code: 'CONFLICT', message: 'רק טיוטה ניתנת לשליחה' });
      }

      const [supplier] = await ctx.db
        .select({ name: suppliers.name, email: suppliers.contactEmail, whatsapp: suppliers.contactWhatsapp })
        .from(suppliers)
        .where(eq(suppliers.id, po.supplierId))
        .limit(1);
      const lines = await ctx.db
        .select({
          rawDescription: poLines.rawDescription,
          qtyOrdered: poLines.qtyOrdered,
          unit: poLines.unit,
        })
        .from(poLines)
        .where(eq(poLines.poId, input.poId));

      let sentChannel: 'email' | 'whatsapp' | null = null;
      if (input.channel !== 'none') {
        // WhatsApp transmission is a paid feature.
        if (input.channel === 'whatsapp') {
          const ent = await getEntitlements(ctx.db, restaurantId);
          if (!ent.active || !ent.features.includes('whatsapp_alerts')) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'ENTITLEMENT_REQUIRED:whatsapp_alerts',
              cause: { code: 'ENTITLEMENT_REQUIRED', feature: 'whatsapp_alerts' },
            });
          }
        }
        const target = input.channel === 'email' ? supplier?.email : supplier?.whatsapp;
        if (!target) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `לספק אין ${input.channel === 'email' ? 'אימייל' : 'וואטסאפ'} מוגדר`,
          });
        }
        const body = renderOrderDocument(supplier?.name ?? 'ספק', po.expectedDeliveryAt, lines);
        // Decouple from the (churning) notifier module: write to the outbox the
        // outboxDispatch worker already drains.
        await ctx.db.insert(notificationsOutbox).values({
          restaurantId,
          channel: input.channel,
          target,
          subject: `הזמנה חדשה — ${supplier?.name ?? ''}`.trim(),
          body,
          status: 'queued',
          relatedEntityType: 'purchase_order',
          relatedEntityId: input.poId,
        });
        sentChannel = input.channel;
      }

      await ctx.db
        .update(purchaseOrders)
        .set({ status: 'sent', sentAt: new Date(), sentChannel, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, input.poId));
      return { ok: true, sentChannel };
    }),

  /** Order-time leak guardrail preview (advanced_analytics). */
  guardrail: memberProcedure
    .use(requireFeature('advanced_analytics'))
    .input(
      z.object({
        supplierId: z.string().uuid(),
        lines: z
          .array(z.object({ productId: z.string().uuid(), unitPriceExpected: z.number().nonnegative() }))
          .max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const windowDays = await baselineWindow(ctx.db, restaurantId);
      const warnings = await computeGuardrail(ctx.db, restaurantId, input.supplierId, input.lines, windowDays);
      return { warnings };
    }),
});

/** Render a Hebrew order document for the outbox body. */
function renderOrderDocument(
  supplierName: string,
  expectedDeliveryAt: Date | null,
  lines: Array<{ rawDescription: string | null; qtyOrdered: string; unit: string }>,
): string {
  const header = `הזמנה לספק ${supplierName}`;
  const delivery = expectedDeliveryAt
    ? `אספקה מבוקשת: ${expectedDeliveryAt.toLocaleDateString('he-IL')}`
    : '';
  const items = lines
    .map((l) => `• ${l.rawDescription ?? 'פריט'} — ${l.qtyOrdered} ${l.unit}`)
    .join('\n');
  return [header, delivery, '', items].filter(Boolean).join('\n');
}
