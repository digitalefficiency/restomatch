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
  invoiceLines,
  invoices,
  lte,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
} from '@restomatch/db';
import { enqueueOcrInvoice } from '@restomatch/queue';
import { assertGrOwned, assertInvoiceOwned, assertSupplierOwned } from '../tenant';
import { isAllowedScanUrl } from '../lib/scanUrls';
import { endOfDayInTz, startOfDayInTz } from '../lib/time';
import { managerProcedure, memberProcedure, receiverProcedure, router } from '../trpc';

const DEFAULT_TZ = 'Asia/Jerusalem';

const TodayExpectationSchema = z.object({
  poId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  expectedAt: z.string(),
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
        expectedAt: purchaseOrders.expectedDeliveryAt,
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
          gte(purchaseOrders.expectedDeliveryAt, startOfDay),
          lte(purchaseOrders.expectedDeliveryAt, endOfDay),
          inArray(purchaseOrders.status, ['sent', 'confirmed', 'partial']),
        ),
      )
      .orderBy(asc(purchaseOrders.expectedDeliveryAt));

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
      expectedAt: r.expectedAt?.toISOString() ?? new Date().toISOString(),
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

      const lines = await ctx.db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(asc(poLines.id));

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
          rawDescription: poLines.rawDescription,
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
        })),
      };
    }),

  /**
   * Invoice detail for the receiving / review screen: OCR status + confidence,
   * invoice number, and parsed invoice lines. Tenant scoped on
   * invoices.restaurantId.
   */
  getInvoice: memberProcedure
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

      const lines = await ctx.db
        .select({
          id: invoiceLines.id,
          productId: invoiceLines.productId,
          rawDescription: invoiceLines.rawDescription,
          qtyBilled: invoiceLines.qtyBilled,
          unit: invoiceLines.unit,
          unitPriceBilled: invoiceLines.unitPriceBilled,
          lineTotal: invoiceLines.lineTotal,
          vatRate: invoiceLines.vatRate,
          ocrConfidenceLine: invoiceLines.ocrConfidenceLine,
        })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, invoice.id))
        .orderBy(asc(invoiceLines.id));

      return { ...invoice, lines };
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
      await assertInvoiceOwned(ctx.db, input.invoiceId, restaurantId);
      const p = input.patch;
      const set: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
      if (p.invoiceNumber !== undefined) set.invoiceNumber = p.invoiceNumber?.trim() || null;
      if (p.invoiceDate !== undefined) set.invoiceDate = p.invoiceDate;
      if (p.totalExclVat !== undefined)
        set.totalExclVat = p.totalExclVat == null ? null : String(p.totalExclVat);
      if (p.vatAmount !== undefined) set.vatAmount = p.vatAmount == null ? null : String(p.vatAmount);
      if (p.totalInclVat !== undefined)
        set.totalInclVat = p.totalInclVat == null ? null : String(p.totalInclVat);
      await ctx.db
        .update(invoices)
        .set(set)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)));
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
      if (p.rawDescription !== undefined) set.rawDescription = p.rawDescription;
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

      const [receipt] = await ctx.db
        .insert(goodsReceipts)
        .values({
          restaurantId: ctx.session.restaurantId,
          poId: input.poId,
          receivedBy: ctx.session.userId,
          status: 'pending',
        })
        .returning();
      if (!receipt) throw new Error('failed to create goods receipt');

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
      z.object({ grId: z.string().uuid(), signatureUrl: z.string().url().max(2048).optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGrOwned(ctx.db, input.grId, ctx.session.restaurantId);

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

      // M8: idempotent on (restaurant, image URL). A double-tap / client retry
      // used to create a second invoice row AND a second OCR job (double spend),
      // which the matcher then flagged as a false DUPLICATE_INVOICE.
      const [existing] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.restaurantId, ctx.session.restaurantId),
            eq(invoices.rawImageUrl, input.imageUrl),
          ),
        )
        .limit(1);
      if (existing) {
        return { invoiceId: existing.id, alreadyExisted: true as const };
      }

      const [invoice] = await ctx.db
        .insert(invoices)
        .values({
          restaurantId: ctx.session.restaurantId,
          supplierId: input.supplierId,
          rawImageUrl: input.imageUrl,
          status: 'ocr_pending',
          source: 'photo',
          createdBy: ctx.session.userId,
        })
        .returning();
      if (!invoice) throw new Error('failed to register invoice');

      // Server-authoritative enqueue of the OCR job. The queue producer no-ops
      // (console.warn) when REDIS_URL is unset, so wrap defensively to ensure a
      // transient enqueue failure never rolls back an already-persisted invoice.
      try {
        await enqueueOcrInvoice({
          restaurantId: ctx.session.restaurantId,
          invoiceId: invoice.id,
          supplierId: input.supplierId,
          imageUrl: input.imageUrl,
        });
      } catch (err) {
        console.error(
          `[receiving.registerInvoice] failed to enqueue ocr-invoice for invoice=${invoice.id}`,
          err,
        );
      }

      return { invoiceId: invoice.id, alreadyExisted: false as const };
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
});
