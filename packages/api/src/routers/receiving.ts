import { z } from 'zod';
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
  invoices,
  lte,
  poLines,
  purchaseOrders,
  suppliers,
} from '@restomatch/db';
import { memberProcedure, receiverProcedure, router } from '../trpc';

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
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

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
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
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
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .where(
          and(
            eq(purchaseOrders.id, input.poId),
            eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1);
      if (!po) throw new Error('PO not found');

      const lines = await ctx.db
        .select()
        .from(poLines)
        .where(eq(poLines.poId, input.poId))
        .orderBy(asc(poLines.id));

      return { ...po, lines };
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
      if (!po[0]) throw new Error('PO not found');

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
        qtyReceived: z.number().nonnegative(),
        qtyRejected: z.number().nonnegative().default(0),
        rejectReason: z.string().max(500).optional(),
        conditionNotes: z.string().max(500).optional(),
        condition: ConditionEnum.optional(),
        photos: z.array(z.string().url()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
        .where(eq(grLines.id, input.grLineId))
        .returning();
      if (!updated) throw new Error('GR line not found');
      return updated;
    }),

  /**
   * Close the goods receipt. Status = 'completed' if every line met or
   * exceeded its ordered qty; 'partial' otherwise.
   */
  submitReceipt: receiverProcedure
    .input(z.object({ grId: z.string().uuid(), signatureUrl: z.string().url().optional() }))
    .mutation(async ({ ctx, input }) => {
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
      if (!receipt) throw new Error('GR not found');
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
        imageUrl: z.string().url(),
        supplierId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      return { invoiceId: invoice.id };
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
      .leftJoin(suppliers, eq(suppliers.id, invoices.supplierId))
      .where(
        and(
          eq(invoices.restaurantId, ctx.session.restaurantId),
          inArray(invoices.status, ['ocr_pending', 'parsed']),
        ),
      )
      .orderBy(desc(invoices.createdAt));
  }),
});
