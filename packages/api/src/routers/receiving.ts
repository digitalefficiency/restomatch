import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  and,
  asc,
  count,
  desc,
  eq,
  goodsReceipts,
  grLines,
  gte,
  inArray,
  isNotNull,
  isNull,
  invoiceLines,
  or,
  sql,
  invoices,
  lte,
  matchRuns,
  ne,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  type Database,
} from '@restomatch/db';
import { enqueueMatchInvoice, enqueueOcrInvoice, isQueueUnavailableError } from '@restomatch/queue';
import type { InvoiceOcrResult } from '@restomatch/types';
import { assertGrOwned, assertSupplierOwned } from '../tenant';
import { fillEnglishNames } from '../receiving/english';
import {
  invoicesWaitingOnReceipt,
  lockReceipt,
  scannedInvoicesForReceipt,
} from '../receiving/matchTriggers';
import { devOcrStubEnabled, buildDevOcrStub } from '../receiving/devOcrStub';
import { isAllowedScanUrl } from '../lib/scanUrls';
import { isInvoiceNumberTaken, readDuplicateOf, withoutDuplicateOf } from '../lib/invoiceDedupe';
import { appError } from '../errors';
import { endOfDayInTz, startOfDayInTz } from '../lib/time';
import { invoiceReaderProcedure, managerProcedure, memberProcedure, receiverProcedure, router } from '../trpc';
import { isFeatureOn } from '../lib/featureGate';
import { dockPriceContext } from '../dockPriceContext/service';

const DEFAULT_TZ = 'Asia/Jerusalem';
/** R5: undated open POs this recent still show in the receiving inbox. */
const UNDATED_LOOKBACK_DAYS = 14;

const TodayExpectationSchema = z.object({
  poId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  /** ISO delivery time; for an undated PO this is its sent/created time. */
  expectedAt: z.string(),
  /** R5: false when the PO has no expected_delivery_at (still listed). */
  hasDeliveryDate: z.boolean(),
  supplierNameEn: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  status: z.string(),
  receiptId: z.string().uuid().nullable(),
  receiptStatus: z.string().nullable(),
});
export type TodayExpectation = z.infer<typeof TodayExpectationSchema>;

const ConditionEnum = z.enum(['ok', 'damaged', 'rejected']);

export const receivingRouter = router({
  /**
   * Returns POs scheduled for delivery today for the active restaurant,
   * with any in-progress goods_receipt status surfaced.
   */
  todayExpectations: memberProcedure.query(async ({ ctx }): Promise<TodayExpectation[]> => {
    // Day boundaries must follow the RESTAURANT'S wall clock, not the server's
    // local time (UTC in prod) — otherwise "today" is wrong by up to a day at
    // either end. Load the restaurant timezone (default Asia/Jerusalem).
    const [restaurant] = await ctx.db
      .select({ timezone: restaurants.timezone })
      .from(restaurants)
      .where(eq(restaurants.id, ctx.session.restaurantId))
      .limit(1);
    const tz = restaurant?.timezone ?? DEFAULT_TZ;
    const now = new Date();
    const startOfDay = startOfDayInTz(now, tz);
    const endOfDay = endOfDayInTz(now, tz);

    const rows = await ctx.db
      .select({
        poId: purchaseOrders.id,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        supplierNameEn: suppliers.nameEn,
        expectedAt: purchaseOrders.expectedDeliveryAt,
        sentAt: purchaseOrders.sentAt,
        createdAt: purchaseOrders.createdAt,
        status: purchaseOrders.status,
        receiptId: goodsReceipts.id,
        receiptStatus: goodsReceipts.status,
      })
      .from(purchaseOrders)
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.id, purchaseOrders.supplierId),
          eq(suppliers.restaurantId, ctx.session.restaurantId),
        ),
      )
      .leftJoin(goodsReceipts, eq(goodsReceipts.poId, purchaseOrders.id))
      .where(
        and(
          eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          inArray(purchaseOrders.status, ['sent', 'confirmed', 'partial']),
          // R5: a PO without a delivery date used to be invisible here — the
          // receiver could never open it. Show recent undated open POs too.
          or(
            and(
              gte(purchaseOrders.expectedDeliveryAt, startOfDay),
              lte(purchaseOrders.expectedDeliveryAt, endOfDay),
            ),
            and(
              isNull(purchaseOrders.expectedDeliveryAt),
              gte(
                purchaseOrders.createdAt,
                new Date(startOfDay.getTime() - UNDATED_LOOKBACK_DAYS * 86_400_000),
              ),
            ),
          ),
        ),
      )
      // Dated deliveries first (by time), then undated (newest first).
      .orderBy(
        sql`${purchaseOrders.expectedDeliveryAt} asc nulls last`,
        desc(purchaseOrders.createdAt),
      );

    const poIds = rows.map((r) => r.poId);
    const lineCountMap = new Map<string, number>();
    if (poIds.length > 0) {
      const counts = await ctx.db
        .select({ poId: poLines.poId, c: count(poLines.id) })
        .from(poLines)
        .where(inArray(poLines.poId, poIds))
        .groupBy(poLines.poId);
      for (const c of counts) lineCountMap.set(c.poId, Number(c.c));
    }

    return rows.map((r) => ({
      poId: r.poId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      supplierNameEn: r.supplierNameEn ?? null,
      expectedAt: (r.expectedAt ?? r.sentAt ?? r.createdAt).toISOString(),
      hasDeliveryDate: r.expectedAt !== null,
      lineCount: lineCountMap.get(r.poId) ?? 0,
      status: r.status,
      receiptId: r.receiptId ?? null,
      receiptStatus: r.receiptStatus ?? null,
    }));
  }),

  /**
   * Full PO detail for the receiving screen: header + lines.
   */
  getPo: memberProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [po] = await ctx.db
        .select({
          id: purchaseOrders.id,
          supplierId: purchaseOrders.supplierId,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          expectedAt: purchaseOrders.expectedDeliveryAt,
          status: purchaseOrders.status,
          totalEstimated: purchaseOrders.totalEstimated,
        })
        .from(purchaseOrders)
        .innerJoin(
          suppliers,
          and(
            eq(suppliers.id, purchaseOrders.supplierId),
            eq(suppliers.restaurantId, ctx.session.restaurantId),
          ),
        )
        .where(
          and(
            eq(purchaseOrders.id, input.poId),
            eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1);
      if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'PO not found' });

      const rows = await ctx.db
        .select({ line: poLines, productNameEn: products.nameEn })
        .from(poLines)
        .leftJoin(
          products,
          and(eq(products.id, poLines.productId), eq(products.restaurantId, ctx.session.restaurantId)),
        )
        .where(eq(poLines.poId, input.poId))
        .orderBy(asc(poLines.id));

      // English display name: the line's own translation, else the product's.
      const lines = rows.map((r) => ({
        ...r.line,
        productNameEn: r.productNameEn ?? null,
      }));
      return { ...po, lines };
    }),

  /**
   * Goods receipt detail for the receiving screen: the goods_receipts row plus
   * its gr_lines joined to po_lines so the UI has the grLineId (needed by
   * markGrLine), the ordered qty/unit and the current received/rejected qty.
   * Look up by grId, or fall back to the PO's receipt via poId. Tenant scope is
   * enforced on goods_receipts.restaurantId exactly like getPo.
   */
  getReceipt: memberProcedure
    .input(
      z
        .object({
          grId: z.string().uuid().optional(),
          poId: z.string().uuid().optional(),
        })
        .refine((v) => Boolean(v.grId) || Boolean(v.poId), {
          message: 'grId or poId is required',
        }),
    )
    .query(async ({ ctx, input }) => {
      const [receipt] = await ctx.db
        .select({
          id: goodsReceipts.id,
          poId: goodsReceipts.poId,
          status: goodsReceipts.status,
          receivedAt: goodsReceipts.receivedAt,
          signatureUrl: goodsReceipts.signatureUrl,
          notes: goodsReceipts.notes,
        })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
            input.grId
              ? eq(goodsReceipts.id, input.grId)
              : eq(goodsReceipts.poId, input.poId!),
          ),
        )
        .limit(1);
      if (!receipt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Receipt not found' });

      const lines = await ctx.db
        .select({
          grLineId: grLines.id,
          poLineId: grLines.poLineId,
          productId: grLines.productId,
          productName: products.canonicalName,
          productNameEn: products.nameEn,
          rawDescription: poLines.rawDescription,
          rawDescriptionEn: poLines.rawDescriptionEn,
          orderedQty: poLines.qtyOrdered,
          unit: poLines.unit,
          qtyReceived: grLines.qtyReceived,
          qtyRejected: grLines.qtyRejected,
          rejectReason: grLines.rejectReason,
          conditionNotes: grLines.conditionNotes,
          photos: grLines.photos,
        })
        .from(grLines)
        .leftJoin(poLines, eq(poLines.id, grLines.poLineId))
        .leftJoin(products, eq(products.id, grLines.productId))
        .where(eq(grLines.grId, receipt.id))
        .orderBy(asc(grLines.id));

      return {
        ...receipt,
        lines: lines.map((l) => ({
          ...l,
          // Surface a human label even when no catalog product is linked.
          productName: l.productName ?? l.rawDescription ?? null,
          productNameEn: l.productNameEn ?? l.rawDescriptionEn ?? null,
        })),
      };
    }),

  /**
   * Invoice detail for the receiving / review screen: OCR status + confidence,
   * invoice number, and parsed invoice lines. Tenant scoped on
   * invoices.restaurantId.
   */
  getInvoice: invoiceReaderProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({
          id: invoices.id,
          status: invoices.status,
          ocrConfidence: invoices.ocrConfidence,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalExclVat: invoices.totalExclVat,
          vatAmount: invoices.vatAmount,
          totalInclVat: invoices.totalInclVat,
          supplierId: invoices.supplierId,
          rawImageUrl: invoices.rawImageUrl,
          createdAt: invoices.createdAt,
          ocrPayload: invoices.ocrPayload,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.invoiceId),
            eq(invoices.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1);
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });

      const [supplier] = invoice.supplierId
        ? await ctx.db
            .select({ name: suppliers.name, nameEn: suppliers.nameEn })
            .from(suppliers)
            .where(
              and(eq(suppliers.id, invoice.supplierId), eq(suppliers.restaurantId, ctx.session.restaurantId)),
            )
            .limit(1)
        : [];

      const lines = await ctx.db
        .select({
          id: invoiceLines.id,
          productId: invoiceLines.productId,
          rawDescription: invoiceLines.rawDescription,
          rawDescriptionEn: invoiceLines.rawDescriptionEn,
          productNameEn: products.nameEn,
          qtyBilled: invoiceLines.qtyBilled,
          unit: invoiceLines.unit,
          unitPriceBilled: invoiceLines.unitPriceBilled,
          lineTotal: invoiceLines.lineTotal,
          vatRate: invoiceLines.vatRate,
          ocrConfidenceLine: invoiceLines.ocrConfidenceLine,
        })
        .from(invoiceLines)
        .leftJoin(
          products,
          and(eq(products.id, invoiceLines.productId), eq(products.restaurantId, ctx.session.restaurantId)),
        )
        .where(eq(invoiceLines.invoiceId, invoice.id))
        .orderBy(asc(invoiceLines.id));

      // EN-3: the worker marks a final OCR failure in ocr_payload.raw; expose
      // only the flag + reason (never the raw extraction payload).
      const { ocrPayload, ...invoiceFields } = invoice;
      const failure = (ocrPayload?.raw ?? null) as { ocrFailed?: boolean; reason?: string } | null;
      return {
        ...invoiceFields,
        ocrFailed: failure?.ocrFailed === true,
        ocrFailureReason: failure?.ocrFailed === true ? (failure.reason ?? 'extraction_failed') : null,
        // The scanned number already belongs to another invoice of this
        // supplier (worker writeOcrHeader). Only the number is exposed — never
        // the other invoice's id or payload.
        duplicateOf: (() => {
          const d = readDuplicateOf(ocrPayload);
          return d ? { invoiceNumber: d.invoiceNumber } : null;
        })(),
        supplierName: supplier?.name ?? null,
        supplierNameEn: supplier?.nameEn ?? null,
        lines,
      };
    }),

  /**
   * Correct an OCR-misread invoice HEADER (number / date / totals). The ₪ leak
   * is computed from these billed figures, so a wrong OCR read otherwise yields
   * an uncorrectable wrong number — this is the in-app fix. Re-run match.runForInvoice
   * afterwards to recompute discrepancies. Owner/manager only.
   */
  updateInvoiceHeader: managerProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        patch: z
          .object({
            invoiceNumber: z.string().trim().max(120).nullable().optional(),
            invoiceDate: z.coerce.date().nullable().optional(),
            totalExclVat: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
            vatAmount: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
            totalInclVat: z.number().finite().nonnegative().max(100_000_000).nullable().optional(),
          })
          .strict()
          .refine((v) => Object.values(v).some((x) => x !== undefined), {
            message: 'אין שינויים לעדכן',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [current] = await ctx.db
        .select({ supplierId: invoices.supplierId, ocrPayload: invoices.ocrPayload })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
      const p = input.patch;
      const set: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
      if (p.invoiceNumber !== undefined) set.invoiceNumber = p.invoiceNumber?.trim() || null;
      // A real number that saves cleanly settles a "possible duplicate" read;
      // null keeps the marker (the correction form sends null on every save).
      if (set.invoiceNumber && readDuplicateOf(current.ocrPayload)) {
        set.ocrPayload = withoutDuplicateOf(current.ocrPayload);
      }
      if (p.invoiceDate !== undefined) set.invoiceDate = p.invoiceDate;
      if (p.totalExclVat !== undefined)
        set.totalExclVat = p.totalExclVat == null ? null : String(p.totalExclVat);
      if (p.vatAmount !== undefined) set.vatAmount = p.vatAmount == null ? null : String(p.vatAmount);
      if (p.totalInclVat !== undefined)
        set.totalInclVat = p.totalInclVat == null ? null : String(p.totalInclVat);
      try {
        // Savepoint: procedures may already run inside a transaction (RLS), and
        // a unique violation aborts it — the holder lookup below would then
        // fail too. Rolling back only this update keeps the request usable.
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set(set)
            .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)));
        });
      } catch (err) {
        if (!set.invoiceNumber || !isInvoiceNumberTaken(err)) throw err;
        const number = set.invoiceNumber;
        const [holder] = current.supplierId
          ? await ctx.db
              .select({ id: invoices.id, invoiceDate: invoices.invoiceDate })
              .from(invoices)
              .where(
                and(
                  eq(invoices.restaurantId, restaurantId),
                  eq(invoices.supplierId, current.supplierId),
                  eq(invoices.invoiceNumber, number),
                  ne(invoices.id, input.invoiceId),
                ),
              )
              .limit(1)
          : [];
        const holderDate = holder?.invoiceDate ? holder.invoiceDate.toISOString().slice(0, 10) : '—';
        throw appError(
          'CONFLICT',
          'invoice.numberTaken',
          `מספר החשבונית ${number} כבר קיים בחשבונית אחרת של הספק (מתאריך ${holderDate})`,
          { invoiceNumber: number, holderDate, holderInvoiceId: holder?.id ?? '' },
        );
      }
      return { ok: true };
    }),

  /**
   * Correct an OCR-misread invoice LINE (qty / unit / price / total / description).
   * invoice_lines has no restaurant_id — ownership is scoped through the parent
   * invoice join. Owner/manager only; re-run the match afterwards.
   */
  updateInvoiceLine: managerProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        patch: z
          .object({
            rawDescription: z.string().trim().min(1).max(400).optional(),
            qtyBilled: z.number().finite().nonnegative().max(1_000_000).optional(),
            unit: z.string().trim().min(1).max(32).optional(),
            unitPriceBilled: z.number().finite().nonnegative().max(10_000_000).optional(),
            lineTotal: z.number().finite().nonnegative().max(100_000_000).optional(),
          })
          .strict()
          .refine((v) => Object.values(v).some((x) => x !== undefined), {
            message: 'אין שינויים לעדכן',
          }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      // Scope through the parent invoice (invoice_lines carries no restaurant_id).
      const [owned] = await ctx.db
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .innerJoin(
          invoices,
          and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, restaurantId)),
        )
        .where(eq(invoiceLines.id, input.lineId))
        .limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice line not found' });

      const p = input.patch;
      const set: Partial<typeof invoiceLines.$inferInsert> = {};
      if (p.rawDescription !== undefined) {
        set.rawDescription = p.rawDescription;
        // The English rendering described the OLD text — clear it so the next
        // ensureEnglish call re-translates the corrected description.
        set.rawDescriptionEn = null;
      }
      if (p.qtyBilled !== undefined) set.qtyBilled = String(p.qtyBilled);
      if (p.unit !== undefined) set.unit = p.unit;
      if (p.unitPriceBilled !== undefined) set.unitPriceBilled = String(p.unitPriceBilled);
      if (p.lineTotal !== undefined) set.lineTotal = String(p.lineTotal);
      await ctx.db.update(invoiceLines).set(set).where(eq(invoiceLines.id, input.lineId));
      return { ok: true };
    }),

  /**
   * Begin a goods receipt: creates GR + GR lines mirroring the PO.
   * Idempotent — re-calling returns the existing pending receipt.
   */
  startReceipt: receiverProcedure
    .input(z.object({ poId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.poId, input.poId),
            eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return { receiptId: existing[0].id, alreadyExisted: true as const };
      }

      const po = await ctx.db
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, input.poId),
            eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1);
      if (!po[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'PO not found' });

      const lines = await ctx.db.select().from(poLines).where(eq(poLines.poId, input.poId));

      // M7: the partial unique index goods_receipts_po_unique (restaurant_id, po_id)
      // makes this race-safe — a concurrent double-tap conflicts instead of
      // creating a second receipt (which doubled qtyReceived in the match).
      const [receipt] = await ctx.db
        .insert(goodsReceipts)
        .values({
          restaurantId: ctx.session.restaurantId,
          poId: input.poId,
          receivedBy: ctx.session.userId,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning();
      if (!receipt) {
        const [raced] = await ctx.db
          .select({ id: goodsReceipts.id })
          .from(goodsReceipts)
          .where(
            and(
              eq(goodsReceipts.poId, input.poId),
              eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
            ),
          )
          .limit(1);
        if (!raced) throw new Error('failed to create goods receipt');
        return { receiptId: raced.id, alreadyExisted: true as const };
      }

      if (lines.length > 0) {
        await ctx.db.insert(grLines).values(
          lines.map((l) => ({
            grId: receipt.id,
            poLineId: l.id,
            productId: l.productId,
            qtyReceived: '0',
            qtyRejected: '0',
          })),
        );
      }

      return { receiptId: receipt.id, alreadyExisted: false as const };
    }),

  /**
   * Update a single GR line (qty received, rejection, condition).
   */
  markGrLine: receiverProcedure
    .input(
      z.object({
        grLineId: z.string().uuid(),
        qtyReceived: z.number().nonnegative().max(999_999_999),
        qtyRejected: z.number().nonnegative().max(999_999_999).default(0),
        rejectReason: z.string().max(500).optional(),
        conditionNotes: z.string().max(500).optional(),
        condition: ConditionEnum.optional(),
        photos: z.array(z.string().url().max(2048)).max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // gr_lines has no restaurant_id — tenant scope goes through the parent
      // goods_receipt, inside the UPDATE itself so there is no TOCTOU window.
      const [updated] = await ctx.db
        .update(grLines)
        .set({
          qtyReceived: input.qtyReceived.toString(),
          qtyRejected: input.qtyRejected.toString(),
          rejectReason: input.rejectReason ?? null,
          conditionNotes:
            input.condition === 'damaged'
              ? `damaged: ${input.conditionNotes ?? ''}`.trim()
              : input.conditionNotes ?? null,
          photos: input.photos ?? [],
        })
        .where(
          and(
            eq(grLines.id, input.grLineId),
            inArray(
              grLines.grId,
              ctx.db
                .select({ id: goodsReceipts.id })
                .from(goodsReceipts)
                .where(eq(goodsReceipts.restaurantId, ctx.session.restaurantId)),
            ),
          ),
        )
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'GR line not found' });
      return updated;
    }),

  /**
   * Close the goods receipt. Status = 'completed' if every line met or
   * exceeded its ordered qty; 'partial' otherwise.
   */
  submitReceipt: receiverProcedure
    .input(
      z.object({
        grId: z.string().uuid(),
        signatureUrl: z.string().url().max(2048).optional(),
        /** The invoice(s) scanned on this receipt (the wizard's registerInvoice ids). */
        invoiceIds: z.array(z.string().uuid()).max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGrOwned(ctx.db, input.grId, ctx.session.restaurantId);
      // Held to commit: an OCR job deciding whether this receipt is still open
      // waits for us (receiving/matchTriggers).
      await lockReceipt(ctx.db, input.grId);

      const rows = await ctx.db
        .select({
          poLineId: grLines.poLineId,
          qtyReceived: grLines.qtyReceived,
          qtyOrdered: poLines.qtyOrdered,
        })
        .from(grLines)
        .leftJoin(poLines, eq(poLines.id, grLines.poLineId))
        .where(eq(grLines.grId, input.grId));

      const allComplete = rows.every(
        (r) =>
          r.qtyOrdered === null || Number(r.qtyReceived) >= Number(r.qtyOrdered),
      );
      const newStatus: 'completed' | 'partial' = allComplete ? 'completed' : 'partial';

      const [receipt] = await ctx.db
        .update(goodsReceipts)
        .set({
          status: newStatus,
          signatureUrl: input.signatureUrl ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(goodsReceipts.id, input.grId),
            eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
          ),
        )
        .returning();
      if (!receipt) throw new TRPCError({ code: 'NOT_FOUND', message: 'GR not found' });
      await rematchAfterCount(ctx.db, ctx.session.restaurantId, receipt, input.invoiceIds ?? []);
      return receipt;
    }),

  /**
   * Register an invoice for a goods receipt. Creates the invoice row in
   * status=ocr_pending. Caller can then enqueue an `ocr-invoice` job
   * (worker handles OCR + persistence + line creation).
   */
  registerInvoice: receiverProcedure
    .input(
      z.object({
        grId: z.string().uuid(),
        imageUrl: z.string().url().max(2048),
        supplierId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // S4 / A.8: the worker fetches this URL server-side. Only a signed URL on
      // our private invoice-scans bucket is acceptable (no SSRF to internal hosts).
      if (!isAllowedScanUrl(input.imageUrl)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'imageUrl must be a signed invoice-scans URL issued by scans.upload',
        });
      }
      await assertGrOwned(ctx.db, input.grId, ctx.session.restaurantId);
      await assertSupplierOwned(ctx.db, input.supplierId, ctx.session.restaurantId);

      const restaurantId = ctx.session.restaurantId;
      // M8: idempotent on (restaurant, scanned object). A double-tap / client
      // retry used to create a second invoice row AND a second OCR job (double
      // spend), which the matcher then flagged as a false DUPLICATE_INVOICE.
      // The key is the URL WITHOUT its query string: re-signing the same object
      // yields a new token but is still the same scan. The check+insert runs
      // under a per-(restaurant, object) advisory lock so two concurrent taps
      // can't both miss the existing row.
      const objectUrl = input.imageUrl.split('?')[0]!;
      const outcome = await ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`register-invoice:${restaurantId}:${objectUrl}`}))`,
        );
        const [existing] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(
            and(
              eq(invoices.restaurantId, restaurantId),
              sql`split_part(${invoices.rawImageUrl}, '?', 1) = ${objectUrl}`,
            ),
          )
          .limit(1);
        if (existing) return { invoiceId: existing.id, created: false as const };

        const [row] = await tx
          .insert(invoices)
          .values({
            restaurantId,
            supplierId: input.supplierId,
            rawImageUrl: input.imageUrl,
            status: 'ocr_pending',
            source: 'photo',
            createdBy: ctx.session.userId,
          })
          .returning({ id: invoices.id });
        if (!row) throw new Error('failed to register invoice');
        return { invoiceId: row.id, created: true as const };
      });
      if (!outcome.created) {
        return { invoiceId: outcome.invoiceId, alreadyExisted: true as const };
      }
      const invoice = { id: outcome.invoiceId };

      // Local demo (no ANTHROPIC_API_KEY, never in production): a deterministic
      // extraction from the receipt's PO rides the worker's mockProviders path.
      let mockProviders: { docAi: InvoiceOcrResult; claude: InvoiceOcrResult } | undefined;
      if (devOcrStubEnabled()) {
        const stub = await buildDevOcrStub(ctx.db, restaurantId, input.grId);
        if (stub) mockProviders = { docAi: stub, claude: stub };
      }

      // Server-authoritative enqueue of the OCR job (Postgres job_queue). The
      // producer no-ops (console.warn) without a queue database and fails fast
      // (≤3 s, coded 'queue.unavailable') when the database is unreachable — so
      // the invoice stays persisted and the client is told OCR was not queued
      // instead of hanging until the function times out (EN-7). No queue at all
      // also reports ocrQueued:false, so the wizard doesn't poll for 30 s.
      let ocrQueued = false;
      try {
        ocrQueued = await enqueueOcrInvoice({
          restaurantId,
          invoiceId: invoice.id,
          supplierId: input.supplierId,
          imageUrl: input.imageUrl,
          grId: input.grId,
          ...(mockProviders ? { mockProviders } : {}),
        });
      } catch (err) {
        ocrQueued = false;
        console.error(
          `[receiving.registerInvoice] failed to enqueue ocr-invoice for invoice=${invoice.id}` +
            (isQueueUnavailableError(err) ? ' (queue.unavailable)' : ''),
          err,
        );
      }

      return { invoiceId: invoice.id, alreadyExisted: false as const, ocrQueued };
    }),

  /**
   * "Receiver in English": fill missing English names for one PO and/or one
   * invoice — po_lines.raw_description_en, invoice_lines.raw_description_en and
   * the linked products.name_en. The wizard calls it when the UI locale is
   * English. Glossary first (instant, offline), Claude for the rest when
   * ANTHROPIC_API_KEY is set. Idempotent (only NULL columns are written);
   * tenant-guarded (PO / invoice / products must belong to the session's
   * restaurant — foreign ids are NOT_FOUND). Display-only: the ₪ math never
   * reads these columns.
   */
  ensureEnglish: invoiceReaderProcedure
    .input(
      z
        .object({
          poId: z.string().uuid().optional(),
          invoiceId: z.string().uuid().optional(),
        })
        .refine((v) => Boolean(v.poId) || Boolean(v.invoiceId), {
          message: 'poId or invoiceId is required',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return fillEnglishNames(ctx.db, ctx.session.restaurantId, input);
    }),

  /**
   * List invoices awaiting OCR / human review for the receiving screen.
   */
  pendingInvoices: memberProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        supplierId: invoices.supplierId,
        supplierName: suppliers.name,
        status: invoices.status,
        rawImageUrl: invoices.rawImageUrl,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .leftJoin(
        suppliers,
        and(
          eq(suppliers.id, invoices.supplierId),
          eq(suppliers.restaurantId, ctx.session.restaurantId),
        ),
      )
      .where(
        and(
          eq(invoices.restaurantId, ctx.session.restaurantId),
          inArray(invoices.status, ['ocr_pending', 'parsed']),
        ),
      )
      .orderBy(desc(invoices.createdAt));
  }),
  /**
   * Flag `dockPriceContext`: "your usual price" (90-day p50 from this
   * supplier) per mapped invoice line. Read-only and display-only. Without
   * `invoiceId` it only reports whether the flag is on, so the page can decide
   * to render the hint at all; with the flag off it is always `{ enabled: false }`.
   */
  priceContext: invoiceReaderProcedure
    .input(z.object({ invoiceId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const enabled = await isFeatureOn(ctx.db, ctx.session.restaurantId, 'dockPriceContext');
      if (!enabled || !input.invoiceId) return { enabled, lines: [] };
      return { enabled, lines: await dockPriceContext(ctx.db, ctx.session.restaurantId, input.invoiceId) };
    }),
});

/**
 * The count is in: (re-)match the receipt's invoices so the engine sees what was
 * actually received, against the receipt's own PO. The invoices are the ones the wizard scanned on this
 * receipt (tenant-checked here) plus any already matched against it — e.g. a
 * run made before the count, when every line still read as short. The worker
 * replaces such a run (keeping people's decisions) and skips an invoice still in
 * OCR (the OCR job matches it when it lands). A queue failure never fails the
 * submit: the receipt is saved; match.runForInvoice can re-run it on demand.
 */
async function rematchAfterCount(
  db: Database,
  restaurantId: string,
  receipt: { id: string; poId: string | null },
  scanned: string[],
): Promise<void> {
  const grId = receipt.id;
  // The invoices to match against the count: the ones waiting on this receipt
  // (server-side — the wizard's in-memory id is lost on a reload or a retake),
  // the scans the wizard names (narrowed: no unrelated or signed-off invoice),
  // and any matched against this receipt before the count (that run read every
  // line as short). Best-effort in a savepoint: a lookup failure must never fail
  // the submit (match.runForInvoice can re-run it).
  let ids: Set<string>;
  try {
    ids = await db.transaction(async (sp) => {
      const tx = sp as unknown as Database;
      const out = new Set<string>(await invoicesWaitingOnReceipt(tx, restaurantId, grId));
      for (const id of await scannedInvoicesForReceipt(tx, restaurantId, receipt, scanned)) out.add(id);
      const ran = await tx
        .selectDistinct({ id: matchRuns.invoiceId })
        .from(matchRuns)
        .where(and(eq(matchRuns.restaurantId, restaurantId), eq(matchRuns.grId, grId), isNotNull(matchRuns.invoiceId)));
      for (const r of ran) if (r.id) out.add(r.id);
      return out;
    });
  } catch (err) {
    console.error(`[receiving.submitReceipt] could not look up the invoices of gr=${grId}`, err);
    return;
  }
  for (const invoiceId of ids) {
    // A variable, not an object literal: compiles whether or not the queue's job
    // type (S7's Postgres queue, #49) declares the optional fields yet.
    const job: Parameters<typeof enqueueMatchInvoice>[0] & { rematch?: boolean; poId?: string } = {
      restaurantId,
      invoiceId,
      rematch: true,
      // Matched against the order that was counted, not a discovered one.
      ...(receipt.poId ? { poId: receipt.poId } : {}),
    };
    try {
      await enqueueMatchInvoice(job);
    } catch (err) {
      console.error(
        `[receiving.submitReceipt] failed to enqueue the re-match for invoice=${invoiceId}` +
          (isQueueUnavailableError(err) ? ' (queue.unavailable)' : ''),
        err,
      );
    }
  }
}
