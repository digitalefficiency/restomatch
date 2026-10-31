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
  users,
  type Database,
} from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { latestReceiptStatusSql } from '../lib/deliveryState';
import { resolveTolerances } from '@restomatch/matching';
import { ClaudePoParser, ORDER_TEXT_MAX_CHARS, orderTextParserFromEnv } from '@restomatch/ocr';
import { ZesttAdapter } from '@restomatch/procurement';
import { managerProcedure, memberProcedure, requireFeature, router } from '../trpc';
import { orderPriceKey } from '../contracts/orderPrices';
import { resolveExpectedPrice, type ExpectedPrice } from '../orders/expectedPrice';
import { forRole, orderWriteProcedure } from '../orders/access';
import { buildOrderGuide } from '../orders/guide';
import { buildSupplierBoard } from '../orders/board';
import { loadDraft, openDraft as openServerDraft, saveDraft as saveServerDraft } from '../orders/drafts';
import { ORDER_VIEWS, orderViewConditions } from '../orders/views';
import { buildThreeWay } from '../orders/threeWay';
import { assertNoReceipt, lockPo, markSentManually as markPoSentManually, supplierAddress } from '../orders/manualSend';
import { assertPoOwned, assertSupplierOwned } from '../tenant';
import { getEntitlements } from '../entitlements';
import { importPurchaseOrder } from '../orders/importPo';
import { captureOrderDraft } from '../orders/captureOrder';
import { appError } from '../errors';
import { estimateTotal, qty3, recomputePoTotal } from '../orders/totals';
import { DEDUPE_INDEX_PREDICATE } from '../notifications/outbox';
import { supplierMessageState, type SupplierMessageState } from '../notifications/delivery';
import { deriveExpectedDelivery, type DerivedDelivery } from '../lib/deriveDelivery';
import { assertFeatureOn, isFeatureOn } from '../lib/featureGate';
import {
  loadOrderDocument,
  ORDER_DOCUMENT_EXTENSIONS,
  orderDocumentSettingsOf,
  orderPdfFilename,
  renderOrderEmailText,
  renderOrderPdf,
  renderOrderWhatsappText,
} from '../orders/document';
import { addCalendarDaysInTz, localDateKeyInTz, startOfDayInTz, startOfLocalDateInTz } from '../lib/time';
import { poRefOf, renderSupplierMessage } from '../orders/supplierMessage';

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
const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((s) => {
    // A real calendar date: 2026-02-31 must not roll over to March 3.
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'תאריך לא קיים');

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
async function buildSupplierMessage(
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
  return renderSupplierMessage({
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
 * purchase_orders.status — see lib/deliveryState.ts (one derivation for the
 * orders list, the late-delivery e-mail and the expectations list). Display only.
 */
function latestReceiptStatus(restaurantId: string) {
  return latestReceiptStatusSql(restaurantId);
}
const OPEN_PO_STATUSES = ['sent', 'confirmed', 'partial'] as const;
/**
 * One stable line order for the detail page and the supplier document.
 * po_lines has no insertion column (adding one is a schema change), so lines
 * read by description, then id — never by the random UUID alone.
 */
const PO_LINE_ORDER = [sql`${poLines.rawDescription} ASC NULLS LAST`, asc(poLines.id)] as const;

type OrderCtx = { db: Database; session: { restaurantId: string; userId: string } };

/** placeOrder's body, shared with sendMany (one transaction, no nested callers). */
async function placeOrderImpl(
  ctx: OrderCtx,
  input: { poId: string; channel: 'email' | 'whatsapp' | 'none' },
): Promise<{ ok: true; sentChannel: 'email' | 'whatsapp' | null }> {
  const restaurantId = ctx.session.restaurantId;
  await assertPoOwned(ctx.db, input.poId, restaurantId);

  const [po] = await ctx.db
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId,
      expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
      createdBy: purchaseOrders.createdBy,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.poId))
    .limit(1);
  if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
  if (po.status !== 'draft') {
    throw new TRPCError({ code: 'CONFLICT', message: 'רק טיוטה ניתנת לשליחה' });
  }
  // W2-06 §5.9: lock the PO (receiving.startReceipt takes the same lock) and
  // refuse once a goods receipt exists — the goods are already here.
  await lockPo(ctx.db, restaurantId, input.poId);
  await assertNoReceipt(ctx.db, restaurantId, input.poId);

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
    // A typed address (deep-fix class 14): the supplier's e-mail or E.164
    // WhatsApp, never a raw string or a `role:` fan-out. G-06 swap: one line.
    const address = supplierAddress(supplier, input.channel);
    const target = address?.to;
    if (!target) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `לספק אין ${input.channel === 'email' ? 'אימייל' : 'וואטסאפ'} מוגדר`,
      });
    }
    // Flag `orderPricesOut`: SKU + agreed prices + totals, and a PDF on email.
    // Flag off → #100's supplier message (orders.supplierMessagePreview).
    let subject = `הזמנה חדשה — ${supplier?.name ?? ''}`.trim();
    let body: string;
    let payload: Record<string, unknown> | undefined;
    const pricesOut = await isFeatureOn(ctx.db, restaurantId, 'orderPricesOut');
    if (pricesOut) {
      // Extensions (e.g. the supplier-confirmation link) need the PO already
      // `sent`; same transaction, so any later failure rolls this back.
      const placedAt = new Date();
      await ctx.db
        .update(purchaseOrders)
        .set({ status: 'sent', sentAt: placedAt, sentChannel: input.channel, updatedAt: placedAt })
        .where(eq(purchaseOrders.id, input.poId));
      const loaded = await loadOrderDocument(ctx.db, restaurantId, input.poId, {
        mode: 'send',
        userId: ctx.session.userId ?? null,
        placedAt,
        extensions: ORDER_DOCUMENT_EXTENSIONS,
      });
      if (!loaded) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      if (input.channel === 'email') {
        body = renderOrderEmailText(loaded.doc);
        const pdf = await renderOrderPdf(loaded.doc);
        payload = {
          __attachments: [
            {
              filename: orderPdfFilename(loaded.doc),
              contentBase64: Buffer.from(pdf).toString('base64'),
              contentType: 'application/pdf',
            },
          ],
        };
      } else {
        body = renderOrderWhatsappText(loaded.doc);
      }
    } else {
      // Flag off: the same text orders.supplierMessagePreview showed the manager (#100).
      const doc = await buildSupplierMessage(ctx.db, restaurantId, po.createdBy ?? ctx.session.userId, {
        poId: input.poId,
        supplierName: supplier?.name ?? 'ספק',
        expectedDeliveryAt: po.expectedDeliveryAt,
        lines,
      });
      subject = doc.subject;
      body = doc.body;
    }
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
        subject,
        body,
        ...(payload ? { payload } : {}),
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
  return { ok: true as const, sentChannel };
}

/** Every productId belongs to this restaurant, or NOT_FOUND (never a cross-tenant link). */
async function assertProductsOwned(db: Database, restaurantId: string, ids: string[]): Promise<void> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return;
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, uniq)));
  if (rows.length !== uniq.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
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
          /** Open POs by their goods receipt: not yet received / partially / fully received. */
          delivery: z.enum(['awaiting', 'partial', 'received']).optional(),
          /** W2-06 §5.6 queue views (same definition as orders.viewCounts). */
          view: z.enum(ORDER_VIEWS).optional(),
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
      if (input?.view) {
        conds.push(orderViewConditions(restaurantId, await restaurantTz(ctx.db, restaurantId))[input.view]);
      }
      if (input?.delivery) {
        conds.push(inArray(purchaseOrders.status, [...OPEN_PO_STATUSES]));
        if (input.delivery === 'received') conds.push(sql`${receipt} = 'completed'`);
        else if (input.delivery === 'partial') conds.push(sql`${receipt} = 'partial'`);
        else conds.push(sql`COALESCE(${receipt}, 'pending') NOT IN ('completed', 'partial')`);
      }
      const rows = await ctx.db
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
          sentChannel: purchaseOrders.sentChannel,
          createdBy: purchaseOrders.createdBy,
          createdByName: sql<string | null>`(select coalesce(u.name, u.email) from users u where u.id = ${purchaseOrders.createdBy})`,
          /** Sent from the manager's/chef's own WhatsApp: whatsapp, and nothing was queued by us. */
          sentManually: sql<boolean>`(${purchaseOrders.sentChannel} = 'whatsapp' and not exists (
            select 1 from notifications_outbox o where o.restaurant_id = ${restaurantId}
              and o.related_entity_type = 'purchase_order' and o.related_entity_id = ${purchaseOrders.id}))`,
        })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(poLines, eq(poLines.poId, purchaseOrders.id))
        .where(and(...conds))
        .groupBy(purchaseOrders.id, suppliers.name, suppliers.nameEn)
        .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id)) // unique: offset pages never repeat/skip
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
      return forRole(ctx.session.role, rows);
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
      return forRole(ctx.session.role, {
        supplierMessage,
        po,
        lines,
        supplierName: supplier?.name ?? null,
        supplierNameEn: supplier?.nameEn ?? null,
        receiptStatus: receipt?.status ?? null,
      });
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

      // Pre-fill unpriced lines with THE expected price (W2-06 §5.8):
      // contract > the restaurant's own last sent price > list. Never the invoice.
      const unpriced = input.lines.filter(
        (l): l is typeof l & { productId: string } => l.unitPriceExpected == null && !!l.productId,
      );
      const expected =
        unpriced.length > 0
          ? await resolveExpectedPrice(ctx.db, {
              restaurantId,
              supplierId: input.supplierId,
              at: new Date(),
              lines: unpriced.map((l) => ({ productId: l.productId, unit: l.unit })),
            })
          : new Map<string, ExpectedPrice>();

      const resolvedLines = input.lines.map((l) => {
        const fromExpected =
          l.unitPriceExpected == null && l.productId ? expected.get(orderPriceKey(l.productId, l.unit)) : undefined;
        const unitPriceExpected =
          l.unitPriceExpected != null
            ? l.unitPriceExpected.toString()
            : fromExpected !== undefined
              ? fromExpected.unitPrice.toString()
              : null;
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
          qtyOrdered: qty3(l.qty).toString(),
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
  supplierMessagePreview: memberProcedure
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
          .select({
            supplierId: purchaseOrders.supplierId,
            expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
            createdBy: purchaseOrders.createdBy,
          })
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
        // The contact is the order's creator — the same one placeOrder prints.
        return buildSupplierMessage(ctx.db, restaurantId, po.createdBy ?? ctx.session.userId, {
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
      return buildSupplierMessage(ctx.db, restaurantId, ctx.session.userId, {
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

  /**
   * Order capture (flag `orderCapture`): the order message the owner already
   * sent the supplier (WhatsApp / e-mail, pasted or shared) → a DRAFT PO with
   * the supplier and catalog lines matched. `needs_supplier` asks the owner to
   * pick one (pass it back as supplierId). Confirm = placeOrder {channel:'none'}.
   */
  captureFromText: managerProcedure
    .input(
      z.object({
        text: z.string().trim().min(1).max(ORDER_TEXT_MAX_CHARS),
        supplierId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [r] = await ctx.db
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      if (!featureEnabled(r?.settings, 'orderCapture')) {
        throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'הפיצ׳ר אינו פעיל עבור המסעדה');
      }
      return captureOrderDraft(ctx.db, {
        restaurantId,
        text: input.text,
        supplierId: input.supplierId ?? null,
        parser: orderTextParserFromEnv(),
        source: 'manual',
        createdBy: ctx.session.userId,
      });
    }),

  cancelOrder: managerProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      // Lock the PO first: receiving.startReceipt takes the same row lock, so a
      // cancel and a receipt start serialize. The UPDATE below is a NEW statement
      // (fresh READ COMMITTED snapshot), so it sees a receipt committed while we
      // waited — a cancelled PO can never end up with a goods receipt.
      await ctx.db.execute(
        sql`SELECT 1 FROM purchase_orders WHERE id = ${input.poId} AND restaurant_id = ${restaurantId} FOR UPDATE`,
      );
      // A closed / cancelled order is history, and so is a received one: its
      // status stays 'sent' after receiving, so the receipt itself decides.
      const cancelled = await ctx.db
        .update(purchaseOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(purchaseOrders.id, input.poId),
            eq(purchaseOrders.restaurantId, restaurantId),
            sql`${purchaseOrders.status} NOT IN ('closed', 'cancelled')`,
            sql`NOT EXISTS (SELECT 1 FROM goods_receipts g WHERE g.po_id = ${input.poId} AND g.restaurant_id = ${restaurantId})`,
          ),
        )
        .returning({ id: purchaseOrders.id });
      if (cancelled.length === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'לא ניתן לבטל הזמנה שנסגרה, בוטלה או שכבר התחילה קבלה עליה' });
      }
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
            /** W2-06 §5.5: map (or unmap) a draft line to a catalog product. */
            productId: z.string().uuid().nullable().optional(),
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
      if (p.productId) await assertProductsOwned(ctx.db, restaurantId, [p.productId]);
      const set: Partial<typeof poLines.$inferInsert> = {};
      if (p.productId !== undefined) set.productId = p.productId;
      if (p.rawDescription !== undefined) set.rawDescription = p.rawDescription;
      if (p.qtyOrdered !== undefined) set.qtyOrdered = String(qty3(p.qtyOrdered));
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
    .mutation(({ ctx, input }) => placeOrderImpl(ctx, input)),

  /** Order-document settings (flag `orderPricesOut`). `enabled` false → the UI hides the controls. */
  documentSettings: memberProcedure.query(async ({ ctx }) => {
    const restaurantId = ctx.session.restaurantId;
    const [row] = await ctx.db
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    return { enabled: featureEnabled(row?.settings, 'orderPricesOut'), ...orderDocumentSettingsOf(row?.settings) };
  }),

  /** Show or hide prices on what the supplier receives (owner / manager). */
  setDocumentSettings: managerProcedure
    .input(z.object({ showPrices: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, restaurantId, 'orderPricesOut');
      // jsonb_set in one statement: no read-modify-write race with other settings writers.
      await ctx.db
        .update(restaurants)
        .set({
          settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), '{orderDocument}',
            coalesce(${restaurants.settings} -> 'orderDocument', '{}'::jsonb) || ${JSON.stringify({ showPrices: input.showPrices })}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, restaurantId));
      return { showPrices: input.showPrices };
    }),

  /** What the supplier receives for this PO: email text, WhatsApp text and the PDF (base64). */
  documentPreview: managerProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertFeatureOn(ctx.db, restaurantId, 'orderPricesOut');
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      const loaded = await loadOrderDocument(ctx.db, restaurantId, input.poId, {
        mode: 'preview',
        userId: ctx.session.userId ?? null,
        extensions: ORDER_DOCUMENT_EXTENSIONS,
      });
      if (!loaded) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      const pdf = await renderOrderPdf(loaded.doc);
      return {
        emailText: renderOrderEmailText(loaded.doc),
        whatsappText: renderOrderWhatsappText(loaded.doc),
        pdfBase64: Buffer.from(pdf).toString('base64'),
        filename: orderPdfFilename(loaded.doc),
        showPrices: loaded.doc.showPrices,
        totalAgorot: loaded.doc.totalAgorot,
        hasUnpricedLines: loaded.doc.hasUnpricedLines,
      };
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

  // ───────────────────────── W2-06: Orders 2 ─────────────────────────

  /** The order guide (§5.1): the usual items from this supplier's last 8 POs. No qty is ever invented. */
  orderGuide: orderWriteProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      const guide = await buildOrderGuide(ctx.db, { restaurantId, supplierId: input.supplierId });
      return forRole(ctx.session.role, guide);
    }),

  /** The cut-off board (§5.2): every active supplier, next cut-off first, in one batched query. */
  supplierBoard: memberProcedure.query(async ({ ctx }) => {
    const board = await buildSupplierBoard(ctx.db, {
      restaurantId: ctx.session.restaurantId,
      userId: ctx.session.userId ?? null,
    });
    // The platform WhatsApp is plan-gated (until H-05); without it, "מהוואטסאפ שלי" is the default.
    const ent = await getEntitlements(ctx.db, ctx.session.restaurantId);
    const platformWhatsapp = ent.active && ent.features.includes('whatsapp_alerts');
    return forRole(ctx.session.role, { ...board, platformWhatsapp });
  }),

  /** The caller's open server draft for a supplier (§5.7), or null. */
  openDraft: orderWriteProcedure
    .input(z.object({ supplierId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      return openServerDraft(ctx.db, { restaurantId, userId: ctx.session.userId, supplierId: input.supplierId });
    }),

  /** Save the wizard at every line (§5.7): xmin version, advisory lock, GR check, stale → CONFLICT. */
  saveDraft: orderWriteProcedure
    .input(
      z.object({
        draftId: z.string().uuid().nullish(),
        supplierId: z.string().uuid(),
        lines: z
          .array(
            z
              .object({
                productId: z.string().uuid().nullish(),
                rawDescription: z.string().trim().max(400).nullish(),
                qty: z.number().positive().max(1_000_000),
                unit: z.string().trim().min(1).max(32),
                unitPriceExpected: z.number().nonnegative().max(10_000_000).nullish(),
              })
              .strict()
              .refine((l) => !!l.productId || !!l.rawDescription, { message: 'line needs a product or a description' }),
          )
          .max(500),
        deliveryDate: LocalDate.nullish(),
        version: z.string().max(32).nullish(),
        clientMutationId: z.string().min(8).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertSupplierOwned(ctx.db, input.supplierId, restaurantId);
      if (input.draftId) await assertPoOwned(ctx.db, input.draftId, restaurantId);
      if (input.lines.some((l) => l.productId)) {
        await assertProductsOwned(ctx.db, restaurantId, input.lines.flatMap((l) => (l.productId ? [l.productId] : [])));
      }
      // No picked day → the schedule's day (as createDraft derives it), else none.
      const expectedDeliveryAt = input.deliveryDate
        ? deliveryFromLocalDate(input.deliveryDate, new Date(), await restaurantTz(ctx.db, restaurantId))
        : ((await deriveForSupplier(ctx.db, restaurantId, input.supplierId, new Date()))?.expectedDeliveryAt ?? null);
      return saveServerDraft(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        draftId: input.draftId ?? null,
        supplierId: input.supplierId,
        lines: input.lines,
        expectedDeliveryAt,
        version: input.version ?? null,
        clientMutationId: input.clientMutationId,
      });
    }),

  /**
   * The exact text "מהוואטסאפ שלי" opens (§5.3), fetched on that explicit choice,
   * never on page open. Read-only and idempotent: nothing is minted or queued.
   */
  prepareManualSend: orderWriteProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      const [po] = await ctx.db
        .select({
          status: purchaseOrders.status,
          supplierId: purchaseOrders.supplierId,
          expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
          createdBy: purchaseOrders.createdBy,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.poId))
        .limit(1);
      if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      const [supplier] = await ctx.db
        .select({ name: suppliers.name, email: suppliers.contactEmail, whatsapp: suppliers.contactWhatsapp })
        .from(suppliers)
        .where(eq(suppliers.id, po.supplierId))
        .limit(1);
      let text: string;
      if (await isFeatureOn(ctx.db, restaurantId, 'orderPricesOut')) {
        // No extensions: the confirm link needs a SENT order, and this text is
        // read before the tap. G-10's link is not part of a manual send.
        const loaded = await loadOrderDocument(ctx.db, restaurantId, input.poId, {
          mode: 'preview',
          userId: ctx.session.userId ?? null,
          extensions: [],
        });
        if (!loaded) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
        text = renderOrderWhatsappText(loaded.doc);
      } else {
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
        text = (
          await buildSupplierMessage(ctx.db, restaurantId, po.createdBy ?? ctx.session.userId, {
            poId: input.poId,
            supplierName: supplier?.name ?? 'ספק',
            expectedDeliveryAt: po.expectedDeliveryAt,
            lines,
          })
        ).body;
      }
      const wa = supplierAddress(supplier, 'whatsapp');
      return { poId: input.poId, status: po.status, text, whatsappTo: wa?.to ?? null };
    }),

  /** "שלחתי מהוואטסאפ שלי" (§5.3): draft → sent, whatsapp, no outbox row, idempotent. */
  markSentManually: orderWriteProcedure
    .input(z.object({ poId: z.string().uuid(), clientMutationId: z.string().min(8).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      return markPoSentManually(ctx.db, { restaurantId, poId: input.poId });
    }),

  /** Add a line to a DRAFT (§5.5), priced with the expected price when unpriced. */
  addOrderLine: orderWriteProcedure
    .input(
      z.object({
        poId: z.string().uuid(),
        line: LineInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      const row = await lockPo(ctx.db, restaurantId, input.poId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      if (row.status !== 'draft') throw new TRPCError({ code: 'CONFLICT', message: 'רק שורות בטיוטה ניתנות לעריכה' });
      const l = input.line;
      if (l.productId) await assertProductsOwned(ctx.db, restaurantId, [l.productId]);
      let price = l.unitPriceExpected ?? null;
      if (price == null && l.productId) {
        const [po] = await ctx.db
          .select({ supplierId: purchaseOrders.supplierId })
          .from(purchaseOrders)
          .where(eq(purchaseOrders.id, input.poId))
          .limit(1);
        const exp = await resolveExpectedPrice(ctx.db, {
          restaurantId,
          supplierId: po!.supplierId,
          at: new Date(),
          lines: [{ productId: l.productId, unit: l.unit }],
        });
        price = exp.get(orderPriceKey(l.productId, l.unit))?.unitPrice ?? null;
      }
      const [inserted] = await ctx.db
        .insert(poLines)
        .values({
          poId: input.poId,
          productId: l.productId ?? null,
          rawDescription: l.rawDescription ?? null,
          qtyOrdered: String(qty3(l.qty)),
          unit: l.unit,
          unitPriceExpected: price == null ? null : String(price),
        })
        .returning({ id: poLines.id });
      const totalEstimated = await recomputePoTotal(ctx.db, input.poId);
      return { ok: true, lineId: inserted!.id, totalEstimated };
    }),

  /**
   * Bulk send (§5.6): all-or-nothing. Every item must still be the draft the
   * list showed (`expectedStatus`); any mismatch → CONFLICT naming the POs and
   * nothing is sent. 'manual' records the batch as sent without queueing.
   */
  sendMany: orderWriteProcedure
    .input(
      z.object({
        items: z
          .array(z.object({ poId: z.string().uuid(), expectedStatus: z.literal('draft') }))
          .min(1)
          .max(50),
        channel: z.enum(['email', 'whatsapp', 'none']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const ids = [...new Set(input.items.map((i) => i.poId))];
      for (const id of ids) await assertPoOwned(ctx.db, id, restaurantId);
      const conflicts: string[] = [];
      for (const id of ids) {
        const row = await lockPo(ctx.db, restaurantId, id);
        if (!row || row.status !== 'draft') conflicts.push(id);
      }
      if (conflicts.length > 0) {
        throw new TRPCError({ code: 'CONFLICT', message: `SEND_MANY_STALE:${conflicts.join(',')}` });
      }
      const results: Array<{ poId: string; sentChannel: 'email' | 'whatsapp' | null }> = [];
      // One transaction (the member procedure's): any failure rolls every send back.
      for (const id of ids) {
        const r = await placeOrderImpl(ctx, { poId: id, channel: input.channel });
        results.push({ poId: id, sentChannel: r.sentChannel });
      }
      return { ok: true, results };
    }),

  /**
   * Amend a SENT order before its cut-off (§5.5): returns the amendment text
   * ("תיקון להזמנה #F8E05686: +2 ק״ג עגבניות") for the user to send with a
   * click — nothing is queued here. Refused once a goods receipt exists or
   * after the supplier's next cut-off.
   */
  amendSent: orderWriteProcedure
    .input(
      z.object({
        poId: z.string().uuid(),
        changes: z
          .array(
            z.object({
              lineId: z.string().uuid().optional(),
              productId: z.string().uuid().optional(),
              rawDescription: z.string().trim().max(400).optional(),
              qtyDelta: z.number().refine((n) => n !== 0, 'zero change').refine((n) => Math.abs(n) <= 1_000_000),
              unit: z.string().trim().min(1).max(32),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      // Tenant checks before any state check: a foreign id is NOT_FOUND, always.
      await assertProductsOwned(ctx.db, restaurantId, input.changes.flatMap((c) => (c.productId ? [c.productId] : [])));
      const row = await lockPo(ctx.db, restaurantId, input.poId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
      if (row.status !== 'sent' && row.status !== 'confirmed') {
        throw new TRPCError({ code: 'CONFLICT', message: 'AMEND_NOT_SENT' });
      }
      await assertNoReceipt(ctx.db, restaurantId, input.poId);
      const [po] = await ctx.db
        .select({ supplierId: purchaseOrders.supplierId })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.poId))
        .limit(1);
      const now = new Date();
      const derived = await deriveForSupplier(ctx.db, restaurantId, po!.supplierId, now);
      if (derived && derived.missedCutoff) {
        throw new TRPCError({ code: 'CONFLICT', message: 'AMEND_AFTER_CUTOFF' });
      }
      // Line names for the text: the PO's own lines, then catalog names.
      const lineIds = input.changes.flatMap((c) => (c.lineId ? [c.lineId] : []));
      const own = lineIds.length
        ? await ctx.db
            .select({ id: poLines.id, productId: poLines.productId, rawDescription: poLines.rawDescription })
            .from(poLines)
            .where(and(eq(poLines.poId, input.poId), inArray(poLines.id, lineIds)))
        : [];
      if (own.length !== new Set(lineIds).size) throw new TRPCError({ code: 'NOT_FOUND', message: 'order line not found' });
      const pids = [
        ...new Set([
          ...input.changes.flatMap((c) => (c.productId ? [c.productId] : [])),
          ...own.flatMap((o) => (o.productId ? [o.productId] : [])),
        ]),
      ];
      if (pids.length) await assertProductsOwned(ctx.db, restaurantId, pids);
      const names = new Map<string, string>();
      if (pids.length) {
        const rows = await ctx.db
          .select({ id: products.id, name: products.canonicalName })
          .from(products)
          .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, pids)));
        for (const r of rows) names.set(r.id, r.name);
      }
      const byLine = new Map(own.map((o) => [o.id, o]));
      const parts = input.changes.map((c) => {
        const o = c.lineId ? byLine.get(c.lineId) : undefined;
        const name =
          c.rawDescription?.trim() ||
          o?.rawDescription?.trim() ||
          (o?.productId ? names.get(o.productId) : undefined) ||
          (c.productId ? names.get(c.productId) : undefined) ||
          '';
        const qty = Math.round(Math.abs(c.qtyDelta) * 1000) / 1000;
        return `${c.qtyDelta > 0 ? '+' : '−'}${qty} ${c.unit} ${name}`.trim();
      });
      const text = `תיקון להזמנה #${poRefOf(input.poId)}: ${parts.join(', ')}`;
      return { poId: input.poId, text, cutoffAt: derived?.nextOrderCutoffAt.toISOString() ?? null };
    }),

  /** Live counts for the list's queue views (§5.6): one query, the list's own definitions. */
  viewCounts: memberProcedure.query(async ({ ctx }) => {
    const restaurantId = ctx.session.restaurantId;
    const v = orderViewConditions(restaurantId, await restaurantTz(ctx.db, restaurantId));
    const [row] = await ctx.db
      .select({
        action: sql<number>`count(*) filter (where ${v.action})::int`,
        today: sql<number>`count(*) filter (where ${v.today})::int`,
        late: sql<number>`count(*) filter (where ${v.late})::int`,
        drafts: sql<number>`count(*) filter (where ${v.drafts})::int`,
        week: sql<number>`count(*) filter (where ${v.week})::int`,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.restaurantId, restaurantId));
    return { action: row?.action ?? 0, today: row?.today ?? 0, late: row?.late ?? 0, drafts: row?.drafts ?? 0, week: row?.week ?? 0 };
  }),

  /** The order's ordered · received · billed · gap ₪ per line (§5.5). ₪ stripped for the receiver. */
  threeWay: memberProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      await assertPoOwned(ctx.db, input.poId, restaurantId);
      return forRole(ctx.session.role, await buildThreeWay(ctx.db, { restaurantId, poId: input.poId }));
    }),
});
