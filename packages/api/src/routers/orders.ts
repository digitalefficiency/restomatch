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
import { ClaudePoParser } from '@restomatch/ocr';
import { ZesttAdapter } from '@restomatch/procurement';
import { managerProcedure, memberProcedure, requireFeature, router } from '../trpc';
import { assertPoOwned, assertSupplierOwned } from '../tenant';
import { getEntitlements } from '../entitlements';
import { importPurchaseOrder } from '../orders/importPo';
import { deriveExpectedDelivery, type DerivedDelivery } from '../lib/deriveDelivery';

/** Cap on an uploaded order document, decoded — a single-page PO PDF is ~50KB. */
const MAX_PO_DOC_BYTES = 8 * 1024 * 1024;

const DEFAULT_BASELINE_WINDOW_DAYS = 90;
/** Fallback timezone for date formatting when a restaurant has none set. */
const DEFAULT_TZ = 'Asia/Jerusalem';
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

/** Shape returned to the wizard so it can CONFIRM the derived date (never silent). */
export interface DeliveryDerivation {
  expectedDeliveryAt: string; // ISO UTC
  nextOrderCutoffAt: string; // ISO UTC
  missedCutoff: boolean;
  windowUsed: DerivedDelivery['windowUsed'];
}

/**
 * Derive the expected delivery for a supplier as of `nowUtc`, anchored to the
 * restaurant's timezone. Returns null when the supplier has no order schedule
 * (caller keeps manual entry). Holiday set is intentionally omitted — the IL
 * holiday JSON is a later wave (see deriveExpectedDelivery).
 */
async function deriveForSupplier(
  db: Database,
  restaurantId: string,
  supplierId: string,
  nowUtc: Date,
): Promise<DerivedDelivery | null> {
  const [supplier] = await db
    .select({ orderSchedule: suppliers.orderSchedule })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  if (!supplier?.orderSchedule) return null;
  const [restaurant] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = restaurant?.timezone ?? DEFAULT_TZ;
  return deriveExpectedDelivery(supplier.orderSchedule, nowUtc, tz);
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
      const [supplier] = po
        ? await ctx.db
            .select({ name: suppliers.name })
            .from(suppliers)
            .where(eq(suppliers.id, po.supplierId))
            .limit(1)
        : [];
      const lines = await ctx.db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(asc(poLines.id));
      return { po, lines, supplierName: supplier?.name ?? null };
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

      // Cadence: when the manager didn't pick a date, DERIVE it from the
      // supplier's order schedule (NEW POs only — this is createDraft). If the
      // order is placed after today's cutoff, `derivation.missedCutoff` is true
      // and we surface it so the UI can explain the roll rather than silently
      // shifting the date. A supplier with no schedule → derivation is null and
      // expectedDeliveryAt stays whatever the manual entry provided (or null).
      let expectedDeliveryAt: Date | null = input.expectedDeliveryAt ?? null;
      let derivation: DeliveryDerivation | null = null;
      if (!input.expectedDeliveryAt) {
        const derived = await deriveForSupplier(ctx.db, restaurantId, input.supplierId, new Date());
        if (derived) {
          expectedDeliveryAt = derived.expectedDeliveryAt;
          derivation = {
            expectedDeliveryAt: derived.expectedDeliveryAt.toISOString(),
            nextOrderCutoffAt: derived.nextOrderCutoffAt.toISOString(),
            missedCutoff: derived.missedCutoff,
            windowUsed: derived.windowUsed,
          };
        }
      }

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
          expectedDeliveryAt,
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
      return { poId: po.id, derivation };
    }),

  /**
   * Cadence preview for the order wizard: after a supplier is chosen, derive the
   * delivery date the manager will CONFIRM. Returns null when the supplier has
   * no order schedule (the wizard then falls back to manual date entry). The
   * `missedCutoff` flag lets the UI say "too late for tomorrow — next delivery
   * is X" instead of silently rolling.
   */
  previewDelivery: memberProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DeliveryDerivation | null> => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const derived = await deriveForSupplier(ctx.db, restaurantId, input.supplierId, new Date());
      if (!derived) return null;
      return {
        expectedDeliveryAt: derived.expectedDeliveryAt.toISOString(),
        nextOrderCutoffAt: derived.nextOrderCutoffAt.toISOString(),
        missedCutoff: derived.missedCutoff,
        windowUsed: derived.windowUsed,
      };
    }),

  /**
   * Import a purchase order from an uploaded document (Zestt PDF export). Parses
   * the PDF via Claude, resolves the supplier + per-line SKUs, and upserts the
   * order idempotently. A failed totals checksum lands the PO as a draft for
   * review rather than feeding the matcher a misread order.
   *
   * CREDENTIAL GATE: needs ANTHROPIC_API_KEY (mirrors the invoice OCR worker).
   * Until keys are live, ingest stays gated — the procedure fails loudly.
   */
  importPo: managerProcedure
    .input(
      z.object({
        platform: z.literal('zestt').default('zestt'),
        file: z.object({
          filename: z.string().trim().max(255),
          /** base64-encoded PDF/image bytes. */
          base64: z.string().min(1),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'OCR not configured — set ANTHROPIC_API_KEY to import order documents',
        });
      }

      const bytes = Buffer.from(input.file.base64, 'base64');
      if (bytes.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'הקובץ ריק או לא תקין' });
      }
      if (bytes.length > MAX_PO_DOC_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'הקובץ גדול מדי' });
      }

      const adapter = new ZesttAdapter(new ClaudePoParser({ apiKey, platform: 'zestt' }));
      const normalized = await adapter.parseDocument(
        { restaurantId, credentials: { apiKey } },
        bytes,
      );

      const result = await importPurchaseOrder(ctx.db, {
        restaurantId,
        normalized,
        createdBy: ctx.session.userId,
      });
      return result;
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

  /**
   * Edit a single DRAFT order line (qty / unit / price / description) before it
   * is sent. po_lines carries no restaurant_id — ownership + draft-only status
   * are checked through the parent PO. A sent order's lines are frozen (it has
   * already gone to the supplier).
   */
  updateOrderLine: managerProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        patch: z
          .object({
            rawDescription: z.string().trim().min(1).max(400).optional(),
            qtyOrdered: z.number().positive().max(1_000_000).optional(),
            unit: z.string().trim().min(1).max(32).optional(),
            unitPriceExpected: z.number().nonnegative().max(10_000_000).nullable().optional(),
          })
          .strict()
          .refine((v) => Object.values(v).some((x) => x !== undefined), {
            message: 'אין שינויים לעדכן',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [owned] = await ctx.db
        .select({ status: purchaseOrders.status })
        .from(poLines)
        .innerJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, restaurantId)),
        )
        .where(eq(poLines.id, input.lineId))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'order line not found' });
      if (owned.status !== 'draft') {
        throw new TRPCError({ code: 'CONFLICT', message: 'רק שורות בטיוטה ניתנות לעריכה' });
      }
      const p = input.patch;
      const set: Partial<typeof poLines.$inferInsert> = {};
      if (p.rawDescription !== undefined) set.rawDescription = p.rawDescription;
      if (p.qtyOrdered !== undefined) set.qtyOrdered = String(p.qtyOrdered);
      if (p.unit !== undefined) set.unit = p.unit;
      if (p.unitPriceExpected !== undefined)
        set.unitPriceExpected = p.unitPriceExpected == null ? null : String(p.unitPriceExpected);
      await ctx.db.update(poLines).set(set).where(eq(poLines.id, input.lineId));
      return { ok: true };
    }),

  /** Remove a line from a DRAFT order. */
  deleteOrderLine: managerProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [owned] = await ctx.db
        .select({ status: purchaseOrders.status })
        .from(poLines)
        .innerJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, restaurantId)),
        )
        .where(eq(poLines.id, input.lineId))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'order line not found' });
      if (owned.status !== 'draft') {
        throw new TRPCError({ code: 'CONFLICT', message: 'רק שורות בטיוטה ניתנות למחיקה' });
      }
      await ctx.db.delete(poLines).where(eq(poLines.id, input.lineId));
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
      // The delivery date printed on the supplier-facing doc must be formatted
      // in the restaurant's wall-clock timezone, not the server's.
      const [restaurant] = await ctx.db
        .select({ timezone: restaurants.timezone })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      const tz = restaurant?.timezone ?? DEFAULT_TZ;
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
        const body = renderOrderDocument(supplier?.name ?? 'ספק', po.expectedDeliveryAt, lines, tz);
        // Decouple from the (churning) notifier module: write to the outbox the
        // outboxDispatch worker already drains.
        //
        // Idempotency: a dedupeKey scoped to this PO's "placed" send + the
        // partial unique index (notifications_dedupe_key_unique) make a retried
        // or double-fired placeOrder enqueue the row at most once. Without this,
        // a retry would queue a SECOND order document and we'd send the same PO
        // to the supplier twice — a leak we'd be causing. ON CONFLICT DO NOTHING
        // swallows the duplicate quietly; the PO still transitions to `sent`.
        await ctx.db
          .insert(notificationsOutbox)
          .values({
            restaurantId,
            channel: input.channel,
            target,
            subject: `הזמנה חדשה — ${supplier?.name ?? ''}`.trim(),
            body,
            status: 'queued',
            relatedEntityType: 'purchase_order',
            relatedEntityId: input.poId,
            dedupeKey: `po:${input.poId}:placed`,
          })
          .onConflictDoNothing({ target: notificationsOutbox.dedupeKey });
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
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
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
  tz: string = DEFAULT_TZ,
): string {
  const header = `הזמנה לספק ${supplierName}`;
  const delivery = expectedDeliveryAt
    ? `אספקה מבוקשת: ${expectedDeliveryAt.toLocaleDateString('he-IL', { timeZone: tz })}`
    : '';
  const items = lines
    .map((l) => `• ${l.rawDescription ?? 'פריט'} — ${l.qtyOrdered} ${l.unit}`)
    .join('\n');
  return [header, delivery, '', items].filter(Boolean).join('\n');
}
