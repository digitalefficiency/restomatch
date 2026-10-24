import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  count,
  desc,
  eq,
  goodsReceipts,
  inArray,
  isNull,
  notificationsOutbox,
  or,
  poLines,
  priceBaselines,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  supplierCatalogItems,
  users,
  type Database,
} from '@restomatch/db';
import { resolveTolerances } from '@restomatch/matching';
import { ClaudePoParser } from '@restomatch/ocr';
import { ZesttAdapter } from '@restomatch/procurement';
import { managerProcedure, memberProcedure, requireFeature, router } from '../trpc';
import { assertPoOwned, assertSupplierOwned } from '../tenant';
import { getEntitlements } from '../entitlements';
import { importPurchaseOrder } from '../orders/importPo';
import { estimateTotal, recomputePoTotal } from '../orders/totals';
import { DEDUPE_INDEX_PREDICATE } from '../notifications/outbox';
import { supplierMessageState, type SupplierMessageState } from '../notifications/delivery';
import { deriveExpectedDelivery, type DerivedDelivery } from '../lib/deriveDelivery';
import { addCalendarDaysInTz, localDateKeyInTz, startOfDayInTz, startOfLocalDateInTz } from '../lib/time';
import { poRefOf, renderOrderDocument } from '../orders/document';

/** Cap on an uploaded order document, decoded — a single-page PO PDF is ~50KB. */
const MAX_PO_DOC_BYTES = 8 * 1024 * 1024;

const DEFAULT_BASELINE_WINDOW_DAYS = 90;
/** Fallback timezone for date formatting when a restaurant has none set. */
const DEFAULT_TZ = 'Asia/Jerusalem';
/**
 * % over the 90-day median below which the guardrail stays quiet. The bar is
 * max(5%, the restaurant's matching price tolerance): a bump the matcher would
 * never flag on the invoice is not a warning at order time either.
 */
const ELEVATED_PCT = 0.05;

/** The guardrail's minimum % over median for this restaurant. */
export function guardrailThreshold(pricePercent: number | null | undefined): number {
  return Math.max(ELEVATED_PCT, resolveTolerances({ pricePercent: pricePercent ?? undefined }).pricePercent);
}

/** 'high' = above p90 AND over the threshold; 'elevated' = over the threshold only. */
export function guardrailLevel(
  unitPrice: number,
  b: { p50: number; p90: number },
  threshold: number,
): 'high' | 'elevated' | null {
  if (b.p50 <= 0) return null;
  const pctOverMedian = (unitPrice - b.p50) / b.p50;
  if (pctOverMedian <= threshold) return null;
  return unitPrice > b.p90 ? 'high' : 'elevated';
}

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
  threshold: number = ELEVATED_PCT,
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
    const level = guardrailLevel(l.unitPriceExpected, b, threshold);
    if (!level) continue;
    const pctOverMedian = (l.unitPriceExpected - b.p50) / b.p50;
    warnings.push({ productId: l.productId, unitPrice: l.unitPriceExpected, p50: b.p50, p90: b.p90, pctOverMedian, level });
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

async function guardrailSettings(db: Database, restaurantId: string): Promise<{ windowDays: number; threshold: number }> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return {
    windowDays: r?.settings?.baselineWindowDays ?? DEFAULT_BASELINE_WINDOW_DAYS,
    threshold: guardrailThreshold(r?.settings?.tolerances?.pricePercent),
  };
}

/** A restaurant-local calendar date, 'YYYY-MM-DD'. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

async function restaurantTz(db: Database, restaurantId: string): Promise<string> {
  const [r] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return r?.timezone ?? DEFAULT_TZ;
}

/** Fri/Sat — no deliveries (same rule as deriveExpectedDelivery). */
const NO_DELIVERY_WEEKDAYS = new Set(['Fri', 'Sat']);

/**
 * The date the wizard pre-fills when the supplier has no order schedule:
 * tomorrow in the restaurant's timezone, rolled past Fri/Sat.
 */
function defaultDeliveryDate(nowUtc: Date, tz: string): string {
  let day = addCalendarDaysInTz(startOfDayInTz(nowUtc, tz), 1, tz);
  for (let i = 0; i < 3; i++) {
    const midday = new Date(day.getTime() + 12 * 60 * 60 * 1000);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(midday);
    if (!NO_DELIVERY_WEEKDAYS.has(wd)) break;
    day = addCalendarDaysInTz(day, 1, tz);
  }
  return localDateKeyInTz(day, tz);
}

/** A picked delivery date must not be in the past (restaurant-local). */
function deliveryFromLocalDate(dateKey: string, nowUtc: Date, tz: string): Date {
  if (dateKey < localDateKeyInTz(nowUtc, tz)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'תאריך האספקה כבר עבר' });
  }
  return startOfLocalDateInTz(dateKey, tz);
}

/**
 * Everything the supplier-facing document needs, loaded under the caller's
 * tenant: restaurant name + business id, the placing manager as contact, and
 * product names for lines saved with a productId only.
 */
async function buildOrderDocument(
  db: Database,
  restaurantId: string,
  userId: string,
  o: {
    poId?: string;
    supplierName: string;
    expectedDeliveryAt: Date | null;
    lines: Array<{ productId: string | null; rawDescription: string | null; qtyOrdered: string | number; unit: string }>;
  },
): Promise<{ subject: string; body: string }> {
  const [restaurant] = await db
    .select({ name: restaurants.name, businessId: restaurants.businessId, timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const [contact] = await db
    .select({ name: users.name, phone: users.phone, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const ids = [...new Set(o.lines.filter((l) => !l.rawDescription?.trim() && l.productId).map((l) => l.productId!))];
  const nameById = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await db
      .select({ id: products.id, name: products.canonicalName })
      .from(products)
      .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, ids)));
    for (const r of rows) nameById.set(r.id, r.name);
  }
  return renderOrderDocument({
    poRef: o.poId ? poRefOf(o.poId) : null,
    supplierName: o.supplierName,
    restaurant: { name: restaurant?.name ?? '', businessId: restaurant?.businessId ?? null },
    contact: contact ?? null,
    expectedDeliveryAt: o.expectedDeliveryAt,
    lines: o.lines.map((l) => ({
      name: l.rawDescription?.trim() || (l.productId ? (nameById.get(l.productId) ?? null) : null),
      qtyOrdered: l.qtyOrdered,
      unit: l.unit,
    })),
    tz: restaurant?.timezone ?? DEFAULT_TZ,
  });
}


/**
 * The PO's delivery state comes from its latest goods receipt, not from
 * purchase_orders.status: receiving never moves a PO out of 'sent' (and must
 * not — buildMatchInput only discovers sent/confirmed/partial POs, so an
 * invoice arriving after the delivery still finds its order). Display only.
 * The outer column is spelled out: Drizzle leaves `${purchaseOrders.id}`
 * unqualified in a single-table select, where it would bind to g.id.
 */
function latestReceiptStatus(restaurantId: string) {
  return sql<'pending' | 'partial' | 'completed' | 'rejected' | null>`(
    SELECT g.status::text FROM goods_receipts g
    WHERE g.po_id = "purchase_orders"."id" AND g.restaurant_id = ${restaurantId}
    ORDER BY g.received_at DESC, g.created_at DESC LIMIT 1
  )`;
}
const OPEN_PO_STATUSES = ['sent', 'confirmed', 'partial'] as const;
/**
 * One stable line order for the detail page and the supplier document.
 * po_lines has no insertion column (adding one is a schema change), so lines
 * read by description, then id — never by the random UUID alone.
 */
const PO_LINE_ORDER = [sql`${poLines.rawDescription} ASC NULLS LAST`, asc(poLines.id)] as const;

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
          /** Open POs by their goods receipt: not yet received / partially / fully received. */
          delivery: z.enum(['awaiting', 'partial', 'received']).optional(),
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
      const receipt = latestReceiptStatus(restaurantId);
      if (input?.delivery) {
        conds.push(inArray(purchaseOrders.status, [...OPEN_PO_STATUSES]));
        if (input.delivery === 'received') conds.push(sql`${receipt} = 'completed'`);
        else if (input.delivery === 'partial') conds.push(sql`${receipt} = 'partial'`);
        else conds.push(sql`COALESCE(${receipt}, 'pending') NOT IN ('completed', 'partial')`);
      }
      return ctx.db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          status: purchaseOrders.status,
          expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
          totalEstimated: purchaseOrders.totalEstimated,
          sentAt: purchaseOrders.sentAt,
          createdAt: purchaseOrders.createdAt,
          lineCount: count(poLines.id),
          receiptStatus: receipt,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(poLines, eq(poLines.poId, purchaseOrders.id))
        .where(and(...conds))
        .groupBy(purchaseOrders.id, suppliers.name, suppliers.nameEn)
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
      const [receipt] = po
        ? await ctx.db
            .select({ status: latestReceiptStatus(restaurantId) })
            .from(purchaseOrders)
            .where(eq(purchaseOrders.id, input.poId))
            .limit(1)
        : [];
      const [supplier] = po
        ? await ctx.db
            .select({ name: suppliers.name, nameEn: suppliers.nameEn })
            .from(suppliers)
            .where(eq(suppliers.id, po.supplierId))
            .limit(1)
        : [];
      const rawLines = await ctx.db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(...PO_LINE_ORDER);
      // English product names for the "Receiver in English" display (0028).
      const productIds = [...new Set(rawLines.map((l) => l.productId).filter((id): id is string => !!id))];
      const nameEnById = new Map<string, string | null>();
      if (productIds.length > 0) {
        const rows = await ctx.db
          .select({ id: products.id, nameEn: products.nameEn, canonicalName: products.canonicalName })
          .from(products)
          .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, productIds)));
        for (const r of rows) nameEnById.set(r.id, r.nameEn);
      }
      const lines = rawLines.map((l) => ({
        ...l,
        productNameEn: l.productId ? (nameEnById.get(l.productId) ?? null) : null,
      }));
      // What actually happened to the order message — not just the channel picked.
      const [msg] = await ctx.db
        .select({ status: notificationsOutbox.status, lastError: notificationsOutbox.lastError, channel: notificationsOutbox.channel })
        .from(notificationsOutbox)
        .where(
          and(
            eq(notificationsOutbox.restaurantId, restaurantId),
            eq(notificationsOutbox.relatedEntityType, 'purchase_order'),
            eq(notificationsOutbox.relatedEntityId, input.poId),
          ),
        )
        .orderBy(desc(notificationsOutbox.createdAt))
        .limit(1);
      const supplierMessage: SupplierMessageState | null = msg ? supplierMessageState(msg) : null;
      return {
        supplierMessage,
        po,
        lines,
        supplierName: supplier?.name ?? null,
        supplierNameEn: supplier?.nameEn ?? null,
        receiptStatus: receipt?.status ?? null,
      };
    }),

  createDraft: managerProcedure
    .input(
      z.object({
        supplierId: z.string().uuid(),
        expectedDeliveryAt: z.date().optional(),
        /** The date the manager picked in the wizard, restaurant-local. */
        expectedDeliveryDate: LocalDate.optional(),
        notes: z.string().trim().max(2000).optional(),
        lines: z.array(LineInput).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const pickedDelivery = input.expectedDeliveryDate
        ? deliveryFromLocalDate(input.expectedDeliveryDate, new Date(), await restaurantTz(ctx.db, restaurantId))
        : (input.expectedDeliveryAt ?? null);

      // Cadence: when the manager didn't pick a date, DERIVE it from the
      // supplier's order schedule (NEW POs only — this is createDraft). If the
      // order is placed after today's cutoff, `derivation.missedCutoff` is true
      // and we surface it so the UI can explain the roll rather than silently
      // shifting the date. A supplier with no schedule → derivation is null and
      // expectedDeliveryAt stays whatever the manual entry provided (or null).
      let expectedDeliveryAt: Date | null = pickedDelivery;
      let derivation: DeliveryDerivation | null = null;
      if (!pickedDelivery) {
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

      const totalEstimated = estimateTotal(
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
    .query(
      async ({ ctx, input }): Promise<{ derived: DeliveryDerivation | null; defaultDate: string; today: string }> => {
        const restaurantId = ctx.session.restaurantId;
        await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
        const now = new Date();
        const tz = await restaurantTz(ctx.db, restaurantId);
        const derived = await deriveForSupplier(ctx.db, restaurantId, input.supplierId, now);
        return {
          derived: derived
            ? {
                expectedDeliveryAt: derived.expectedDeliveryAt.toISOString(),
                nextOrderCutoffAt: derived.nextOrderCutoffAt.toISOString(),
                missedCutoff: derived.missedCutoff,
                windowUsed: derived.windowUsed,
              }
            : null,
          /** What the wizard's date input starts at: the schedule's date, else tomorrow. */
          defaultDate: derived ? localDateKeyInTz(derived.expectedDeliveryAt, tz) : defaultDeliveryDate(now, tz),
          today: localDateKeyInTz(now, tz),
        };
      },
    ),

  /**
   * Exactly what the supplier will receive, before it is sent: for a saved
   * draft (poId) or for the wizard's unsaved lines. Read-only — nothing queued.
   */
  documentPreview: memberProcedure
    .input(
      z.union([
        z.object({ poId: z.string().uuid() }).strict(),
        z
          .object({
            supplierId: z.string().uuid(),
            expectedDeliveryDate: LocalDate.optional(),
            lines: z
              .array(
                z.object({
                  productId: z.string().uuid().optional(),
                  rawDescription: z.string().trim().max(400).optional(),
                  qty: z.number().nonnegative().max(1_000_000),
                  unit: z.string().trim().min(1).max(32),
                }),
              )
              .max(500),
          })
          .strict(),
      ]),
    )
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      if ('poId' in input) {
        await assertPoOwned(ctx.db, input.poId, restaurantId);
        const [po] = await ctx.db
          .select({ supplierId: purchaseOrders.supplierId, expectedDeliveryAt: purchaseOrders.expectedDeliveryAt })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.poId))
          .limit(1);
        if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
        const [supplier] = await ctx.db
          .select({ name: suppliers.name })
          .from(suppliers)
          .where(eq(suppliers.id, po.supplierId))
          .limit(1);
        const lines = await ctx.db
          .select({ productId: poLines.productId, rawDescription: poLines.rawDescription, qtyOrdered: poLines.qtyOrdered, unit: poLines.unit })
          .from(poLines)
          .where(eq(poLines.poId, input.poId))
          .orderBy(...PO_LINE_ORDER);
        return buildOrderDocument(ctx.db, restaurantId, ctx.session.userId, {
          poId: input.poId,
          supplierName: supplier?.name ?? 'ספק',
          expectedDeliveryAt: po.expectedDeliveryAt,
          lines,
        });
      }
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const [supplier] = await ctx.db
        .select({ name: suppliers.name })
        .from(suppliers)
        .where(eq(suppliers.id, input.supplierId))
        .limit(1);
      const tz = await restaurantTz(ctx.db, restaurantId);
      return buildOrderDocument(ctx.db, restaurantId, ctx.session.userId, {
        supplierName: supplier?.name ?? 'ספק',
        expectedDeliveryAt: input.expectedDeliveryDate ? startOfLocalDateInTz(input.expectedDeliveryDate, tz) : null,
        lines: input.lines.map((l) => ({
          productId: l.productId ?? null,
          rawDescription: l.rawDescription ?? null,
          qtyOrdered: l.qty,
          unit: l.unit,
        })),
      });
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
      const [current] = await ctx.db
        .select({ status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.poId))
        .limit(1);
      // A received (closed) order is history — cancelling it would orphan its
      // goods receipt and invoice match. Cancelling twice is a no-op error.
      if (current && (current.status === 'closed' || current.status === 'cancelled')) {
        throw new TRPCError({ code: 'CONFLICT', message: 'לא ניתן לבטל הזמנה שנסגרה או בוטלה' });
      }
      // Receiving never moves the PO out of 'sent', so a delivered order looks
      // open by status alone: any goods receipt makes it history too.
      const [receipt] = await ctx.db
        .select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.poId, input.poId), eq(goodsReceipts.restaurantId, restaurantId)))
        .limit(1);
      if (receipt) {
        throw new TRPCError({ code: 'CONFLICT', message: 'לא ניתן לבטל הזמנה שכבר התחילה קבלה עליה' });
      }
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
        .select({ status: purchaseOrders.status, poId: purchaseOrders.id })
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
      // Keep the header's estimated total in step with the edited line.
      const totalEstimated = await recomputePoTotal(ctx.db, owned.poId);
      return { ok: true, totalEstimated };
    }),

  /** Remove a line from a DRAFT order. */
  deleteOrderLine: managerProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [owned] = await ctx.db
        .select({ status: purchaseOrders.status, poId: purchaseOrders.id })
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
      const totalEstimated = await recomputePoTotal(ctx.db, owned.poId);
      return { ok: true, totalEstimated };
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
          productId: poLines.productId,
          rawDescription: poLines.rawDescription,
          qtyOrdered: poLines.qtyOrdered,
          unit: poLines.unit,
        })
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(...PO_LINE_ORDER);
      // An empty order would reach the supplier as a blank document.
      if (lines.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'אי אפשר לשלוח הזמנה בלי שורות' });
      }

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
        // The same text orders.documentPreview showed the manager.
        const doc = await buildOrderDocument(ctx.db, restaurantId, ctx.session.userId, {
          poId: input.poId,
          supplierName: supplier?.name ?? 'ספק',
          expectedDeliveryAt: po.expectedDeliveryAt,
          lines,
        });
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
            subject: doc.subject,
            body: doc.body,
            status: 'queued',
            relatedEntityType: 'purchase_order',
            relatedEntityId: input.poId,
            dedupeKey: `po:${input.poId}:placed`,
          })
          .onConflictDoNothing({ target: notificationsOutbox.dedupeKey, where: DEDUPE_INDEX_PREDICATE });
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
      const { windowDays, threshold } = await guardrailSettings(ctx.db, restaurantId);
      const warnings = await computeGuardrail(ctx.db, restaurantId, input.supplierId, input.lines, windowDays, threshold);
      return { warnings };
    }),
});
