import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  auditLog,
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
  lt,
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
  users,
  type Database,
  type OcrPayload,
} from '@restomatch/db';
import { computeInvoiceLeak, HELD_FOR_RECEIPTS_KEY } from '@restomatch/charts';
import { matchByAlias } from '@restomatch/catalog';
import { enqueueMatchInvoice, enqueueOcrInvoice, isQueueUnavailableError } from '@restomatch/queue';
import type { InvoiceOcrResult } from '@restomatch/types';
import { assertGrOwned, assertSupplierOwned } from '../tenant';
import { fillEnglishNames } from '../receiving/english';
import {
  invoicesWaitingOnReceipt,
  lockReceipt,
  readScanGrId,
  rematchHoldReason,
  scannedInvoicesForReceipt,
} from '../receiving/matchTriggers';
import { devOcrStubEnabled, buildDevOcrStub } from '../receiving/devOcrStub';
import { isAllowedScanUrl } from '../lib/scanUrls';
import { isInvoiceNumberTaken, readDuplicateOf, withoutDuplicateOf } from '../lib/invoiceDedupe';
import { appError } from '../errors';
import { recordAudit } from '../audit';
import type { MemberSession } from '../context';
import { matchRouter } from './match';
import { lineTotalAgorot } from '../orders/document/build';
import { agorotToPlain, numericToAgorot } from '../integrations/accounting/common';
import { endOfDayInTz, startOfDayInTz } from '../lib/time';
import { claimableLines } from '../lib/claims';
import { featureEnabled } from '../lib/features';
import { invoiceReaderProcedure, managerProcedure, memberProcedure, receiverProcedure, router } from '../trpc';
import { isFeatureOn } from '../lib/featureGate';
import { dockPriceContext } from '../dockPriceContext/service';
import { readConsolidatedRaw } from '../match/consolidated';

const DEFAULT_TZ = 'Asia/Jerusalem';
/** R5: undated open POs this recent still show in the receiving inbox. */
const UNDATED_LOOKBACK_DAYS = 14;
/** Receiving board: an open PO dated up to this many days back is "late", not gone. */
const LATE_LOOKBACK_DAYS = 7;

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
  /** Only with `includeLate`: dated before today and still not received (closed today → false). */
  late: z.boolean(),
  /** ISO time the receipt was closed (completed / partial); null while open or not started. */
  closedAt: z.string().nullable(),
});
export type TodayExpectation = z.infer<typeof TodayExpectationSchema>;

const ConditionEnum = z.enum(['ok', 'damaged', 'rejected']);

export const receivingRouter = router({
  /**
   * Returns POs scheduled for delivery today for the active restaurant,
   * with any in-progress goods_receipt status surfaced.
   */
  todayExpectations: memberProcedure
    .input(
      z
        .object({
          /**
           * Receiving board: also return open POs dated in the last week that were
           * never received (a missed truck stays visible as "late" instead of
           * vanishing at midnight). Off by default — the plain list stays today-only.
           */
          includeLate: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<TodayExpectation[]> => {
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
        receiptUpdatedAt: goodsReceipts.updatedAt,
      })
      .from(purchaseOrders)
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.id, purchaseOrders.supplierId),
          eq(suppliers.restaurantId, ctx.session.restaurantId),
        ),
      )
      .leftJoin(
        goodsReceipts,
        and(eq(goodsReceipts.poId, purchaseOrders.id), eq(goodsReceipts.restaurantId, ctx.session.restaurantId)),
      )
      .where(
        and(
          eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          // The truck's state ("late", "received") comes from its goods receipt
          // (one per PO), never from purchase_orders.status: a platform sync can mark
          // a PO 'partial' or 'closed' whatever happened at the back door. Open POs are
          // listed; a closed one only when it has a receipt here (its GR decides).
          or(
            inArray(purchaseOrders.status, ['sent', 'confirmed', 'partial']),
            and(eq(purchaseOrders.status, 'closed'), isNotNull(goodsReceipts.id)),
          ),
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
            input?.includeLate
              ? and(
                  gte(purchaseOrders.expectedDeliveryAt, new Date(startOfDay.getTime() - LATE_LOOKBACK_DAYS * 86_400_000)),
                  lt(purchaseOrders.expectedDeliveryAt, startOfDay),
                  // Still open → late. Closed today → stays on the board as received (a
                  // closed receipt is not late: it arrived; the PO status stays 'sent').
                  or(
                    isNull(goodsReceipts.id),
                    eq(goodsReceipts.status, 'pending'),
                    gte(goodsReceipts.updatedAt, startOfDay),
                  ),
                )
              : undefined,
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
      late:
        r.expectedAt !== null &&
        r.expectedAt.getTime() < startOfDay.getTime() &&
        (r.receiptStatus === null || r.receiptStatus === 'pending'),
      closedAt:
        r.receiptStatus && r.receiptStatus !== 'pending' && r.receiptUpdatedAt
          ? r.receiptUpdatedAt.toISOString()
          : null,
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
      const [rest] = await ctx.db
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.session.restaurantId))
        .limit(1);
      return { ...po, lines, features: { dockSlip: featureEnabled(rest?.settings, 'dockSlip') } };
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
          // The receipt's version: changes only when it is closed or reopened. The
          // Delivery Check stamps its offline rows with it so a row counted before a
          // close / reopen is never replayed into the receipt (W1-06 × W1-05).
          updatedAt: goodsReceipts.updatedAt,
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
   * Dock dispute slip (flag `dockSlip`): the header of a receipt plus the ENGINE's
   * ₪ per discrepancy for its invoice — the persisted discrepancies, allocated
   * exactly like the supplier claims letters (claimableLines), never the
   * wizard's client-side estimates. Read-only; tenant-scoped on the receipt and
   * the invoice. `ready` is false until the receipt is closed AND a match run for
   * it ran at/after the close (submitReceipt's re-match) — before that, no ₪.
   */
  dockSlip: invoiceReaderProcedure
    .input(z.object({ grId: z.string().uuid(), invoiceId: z.string().uuid().nullish() }))
    .query(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [rest] = await ctx.db
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      if (!featureEnabled(rest?.settings, 'dockSlip')) return { enabled: false as const };

      const [gr] = await ctx.db
        .select({
          grId: goodsReceipts.id,
          status: goodsReceipts.status,
          closedAt: goodsReceipts.updatedAt,
          receivedAt: goodsReceipts.receivedAt,
          receivedBy: goodsReceipts.receivedBy,
          poId: purchaseOrders.id,
          poRef: purchaseOrders.sourceRef,
          supplierName: suppliers.name,
          supplierNameEn: suppliers.nameEn,
          supplierWhatsapp: suppliers.contactWhatsapp,
        })
        .from(goodsReceipts)
        .leftJoin(
          purchaseOrders,
          and(eq(purchaseOrders.id, goodsReceipts.poId), eq(purchaseOrders.restaurantId, restaurantId)),
        )
        .leftJoin(
          suppliers,
          and(eq(suppliers.id, purchaseOrders.supplierId), eq(suppliers.restaurantId, restaurantId)),
        )
        .where(and(eq(goodsReceipts.id, input.grId), eq(goodsReceipts.restaurantId, restaurantId)))
        .limit(1);
      if (!gr) throw new TRPCError({ code: 'NOT_FOUND', message: 'Receipt not found' });
      // The receiver's name: users is self-only under RLS, so it is read only when
      // the viewer IS the receiver (the person at the dock). Anyone else gets no
      // name rather than a name that would vanish in production.
      let receiverName: string | null = null;
      if (gr.receivedBy && gr.receivedBy === ctx.session.userId) {
        // Display name only — never the login e-mail: this line goes into the
        // WhatsApp text sent to the supplier. No name → no line.
        const [me] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ctx.session.userId))
          .limit(1);
        receiverName = me?.name?.trim() || null;
      }
      // ₪ only from a match run made AFTER the count: a run from before the
      // receipt was closed saw gr_lines empty (every line "short") and must
      // never reach the slip or its WhatsApp text.
      const receiptClosed = gr.status === 'completed' || gr.status === 'partial';

      let invoice: { id: string; number: string | null; duplicateOfNumber: string | null } | null = null;
      let engine: {
        /** The count is in (receipt submitted). Before that the slip shows quantities only. */
        receiptClosed: boolean;
        /** A match run for this receipt from after it closed exists — the ₪ below is final. */
        ready: boolean;
        /**
         * Receipt closed but no post-count run will come on its own (the re-match
         * is held — rematchHoldReason): the slip says why at once instead of
         * waiting. null while a run may still land.
         */
        holdReason: 'settled' | 'awaiting_review' | null;
        totalIls: number;
        lines: Array<{
          discrepancyId: string;
          type: string;
          poLineId: string | null;
          invoiceLineId: string | null;
          productId: string | null;
          productName: string | null;
          productNameEn: string | null;
          lineDescription: string | null;
          lineDescriptionEn: string | null;
          expected: number | null;
          actual: number | null;
          amountIls: number;
        }>;
      } = { receiptClosed, ready: false, holdReason: null, totalIls: 0, lines: [] };

      if (input.invoiceId) {
        const [inv] = await ctx.db
          .select({ id: invoices.id, number: invoices.invoiceNumber, status: invoices.status, ocrPayload: invoices.ocrPayload })
          .from(invoices)
          .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, restaurantId)))
          .limit(1);
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
        invoice = { id: inv.id, number: inv.number, duplicateOfNumber: readDuplicateOf(inv.ocrPayload)?.invoiceNumber ?? null };

        const [{ runs } = { runs: 0 }] = receiptClosed
          ? await ctx.db
              .select({ runs: count() })
              .from(matchRuns)
              .where(
                and(
                  eq(matchRuns.invoiceId, inv.id),
                  eq(matchRuns.restaurantId, restaurantId),
                  eq(matchRuns.grId, gr.grId),
                  gte(matchRuns.runAt, gr.closedAt),
                ),
              )
          : [];
        const ready = Number(runs) > 0;
        let holdReason: 'settled' | 'awaiting_review' | null = null;
        if (receiptClosed && !ready) {
          const [{ any } = { any: 0 }] = await ctx.db
            .select({ any: count() })
            .from(matchRuns)
            .where(and(eq(matchRuns.invoiceId, inv.id), eq(matchRuns.restaurantId, restaurantId)));
          holdReason = rematchHoldReason(inv, Number(any) > 0);
        }
        const leak = ready ? await computeInvoiceLeak(ctx.db, restaurantId, inv.id) : null;
        const claim = leak ? claimableLines(leak) : [];
        const lines = claim.map(({ line, amount }) => ({
          discrepancyId: line.discrepancyId,
          type: line.type,
          poLineId: line.poLineId,
          invoiceLineId: line.invoiceLineId,
          productId: line.productId,
          productName: line.productName,
          productNameEn: line.productNameEn,
          lineDescription: line.lineDescription,
          lineDescriptionEn: line.lineDescriptionEn,
          expected: line.expected,
          actual: line.actual,
          // The letters' amount, to the agora (the letters print each line rounded).
          amountIls: Math.round(amount * 100) / 100,
        }));
        // Summed in agorot so the total is exact.
        const totalIls = lines.reduce((acc, l) => acc + Math.round(l.amountIls * 100), 0) / 100;
        engine = { receiptClosed, ready, holdReason, totalIls, lines };
      }

      return {
        enabled: true as const,
        header: {
          supplierName: gr.supplierName,
          supplierNameEn: gr.supplierNameEn,
          supplierWhatsapp: gr.supplierWhatsapp,
          poId: gr.poId,
          poRef: gr.poRef,
          receivedAt: gr.receivedAt,
          receiverName,
        },
        invoice,
        engine,
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
        // B8: lines may be added / deleted by hand (addInvoiceLine's own rule).
        linesEditable: linesEditable(invoice.status, ocrPayload),
        // What a hand line can be called so it pairs with its order line (the
        // order's descriptions — no ₪). Only while lines can be added.
        // The order's lines for the add-line picker (ordered qty + price): only
        // for the roles that may add lines — a receiver never gets ₪ here.
        orderLines:
          linesEditable(invoice.status, ocrPayload) && (ctx.session.role === 'owner' || ctx.session.role === 'manager')
            ? (await invoiceOrderLines(ctx.db, ctx.session.restaurantId, invoice.id, ocrPayload)).map((l) => ({
                id: l.id,
                name: l.productName ?? l.rawDescription ?? '',
                rawDescription: l.rawDescription,
                qtyOrdered: l.qtyOrdered,
                unit: l.unit,
                unitPriceExpected: l.unitPriceExpected,
              }))
            : [],
        // A חשבונית ריכוז: cross-matched against its delivery notes, never re-matched to a PO.
        consolidated: readConsolidatedRaw(ocrPayload) !== null,
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
        .select({
          supplierId: invoices.supplierId,
          ocrPayload: invoices.ocrPayload,
          invoiceNumber: invoices.invoiceNumber,
          invoiceDate: invoices.invoiceDate,
          totalExclVat: invoices.totalExclVat,
          vatAmount: invoices.vatAmount,
          totalInclVat: invoices.totalInclVat,
        })
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
      // Only the fields this edit touched, before and after.
      const touched = (['invoiceNumber', 'invoiceDate', 'totalExclVat', 'vatAmount', 'totalInclVat'] as const).filter(
        (k) => set[k] !== undefined,
      );
      await recordAudit(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        action: 'receiving.invoice_header_updated',
        entityType: 'invoice',
        entityId: input.invoiceId,
        before: Object.fromEntries(touched.map((k) => [k, current[k]])),
        after: Object.fromEntries(touched.map((k) => [k, set[k]])),
      });
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
        .select({
          id: invoiceLines.id,
          invoiceId: invoiceLines.invoiceId,
          rawDescription: invoiceLines.rawDescription,
          qtyBilled: invoiceLines.qtyBilled,
          unit: invoiceLines.unit,
          unitPriceBilled: invoiceLines.unitPriceBilled,
          lineTotal: invoiceLines.lineTotal,
        })
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
      const keys = (['rawDescription', 'qtyBilled', 'unit', 'unitPriceBilled', 'lineTotal'] as const).filter(
        (k) => set[k] !== undefined,
      );
      await recordAudit(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        action: 'receiving.invoice_line_updated',
        entityType: 'invoice_line',
        entityId: input.lineId,
        before: { invoiceId: owned.invoiceId, ...Object.fromEntries(keys.map((k) => [k, owned[k]])) },
        after: { invoiceId: owned.invoiceId, ...Object.fromEntries(keys.map((k) => [k, set[k]])) },
      });
      return { ok: true };
    }),

  /**
   * B8 — "הזינו את השורות ידנית": add a line by hand to an invoice the OCR could
   * not read (failed → 'parsed', no lines) or held for review ('parsed'). The
   * header totals are recomputed from the lines (integer agorot, NUMERIC strings
   * in the DB) and the invoice is re-matched through match.runForInvoice.
   * Owner / manager only (₪ on the line); audited. A foreign invoice is NOT_FOUND.
   */
  addInvoiceLine: managerProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        line: z
          .object({
            rawDescription: z.string().trim().min(1).max(400),
            qtyBilled: z.number().finite().positive().max(1_000_000),
            unit: z.string().trim().min(1).max(32),
            unitPriceBilled: z.number().finite().nonnegative().max(10_000_000),
            /** The order line this bills (the page's picker): its product / SKU is linked. */
            poLineId: z.string().uuid().optional(),
            /** Optional catalogue link (this restaurant's product). */
            productId: z.string().uuid().optional(),
          })
          .strict(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const inv = await editableInvoice(ctx.db, restaurantId, input.invoiceId);
      if (input.line.productId) {
        const [prod] = await ctx.db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, input.line.productId), eq(products.restaurantId, restaurantId)))
          .limit(1);
        if (!prod) throw new TRPCError({ code: 'NOT_FOUND', message: 'product not found' });
      }
      const orderLines = await invoiceOrderLines(ctx.db, restaurantId, inv.id, inv.ocrPayload);
      let picked: OrderLine | undefined;
      if (input.line.poLineId) {
        // Only a line of THIS invoice's order (tenant-scoped through it).
        picked = orderLines.find((l) => l.id === input.line.poLineId);
        if (!picked) throw new TRPCError({ code: 'NOT_FOUND', message: 'order line not found' });
        if (input.line.productId && picked.productId && input.line.productId !== picked.productId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'המוצר אינו המוצר של שורת ההזמנה שנבחרה' });
        }
      }
      // S16: a hand line must pair with its order line like a read one, or an
      // ordered item reads as "not ordered" + "order line not billed" (a false,
      // inflated claim). Without an explicit product, take it from the
      // invoice's own order when exactly one line has this description.
      const link = picked
        ? { productId: picked.productId ?? input.line.productId ?? null, supplierSku: picked.productId ? null : picked.supplierSku }
        : input.line.productId
          ? { productId: input.line.productId, supplierSku: null }
          : await freeTextLink(ctx.db, restaurantId, inv.supplierId, orderLines, input.line.rawDescription);
      const qty = decimalString(input.line.qtyBilled, 3);
      const price = decimalString(input.line.unitPriceBilled, 4);
      const totalAgorot = lineTotalAgorot(qty, price);
      if (totalAgorot === null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'כמות או מחיר לא תקינים' });
      const [line] = await ctx.db
        .insert(invoiceLines)
        .values({
          invoiceId: inv.id,
          productId: link?.productId ?? null,
          supplierSku: link?.supplierSku ?? null,
          rawDescription: input.line.rawDescription,
          qtyBilled: qty,
          unit: input.line.unit,
          unitPriceBilled: price,
          lineTotal: agorotToPlain(totalAgorot),
        })
        .returning({ id: invoiceLines.id });
      if (!line) throw new Error('failed to add invoice line');
      if (!inv.handEntered) {
        // A held-for-review read that now has hand-entered lines stays editable
        // after the re-match (which moves it out of 'parsed').
        const payload = inv.ocrPayload;
        await ctx.db
          .update(invoices)
          .set({
            ocrPayload: {
              provider: payload?.provider ?? 'claude_vision',
              ...(payload?.reconciledAt ? { reconciledAt: payload.reconciledAt } : {}),
              raw: { ...((payload?.raw as object | null) ?? {}), manualLines: true },
            },
          })
          .where(and(eq(invoices.id, inv.id), eq(invoices.restaurantId, restaurantId)));
      }
      const totals = await recomputeInvoiceTotals(ctx.db, restaurantId, inv);
      await recordAudit(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        action: 'receiving.invoice_line_added',
        entityType: 'invoice_line',
        entityId: line.id,
        before: { invoiceId: inv.id, totals: inv.totals },
        after: {
          invoiceId: inv.id,
          line: { rawDescription: input.line.rawDescription, qtyBilled: qty, unit: input.line.unit, unitPriceBilled: price, lineTotal: agorotToPlain(totalAgorot), productId: link?.productId ?? null },
          totals,
        },
      });
      const rematched = await rematchAfterEdit(ctx, inv.id);
      return { lineId: line.id, totals, rematched };
    }),

  /** B8 — remove a hand-entered (or misread) line; same rules as addInvoiceLine. */
  deleteInvoiceLine: managerProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const restaurantId = ctx.session.restaurantId;
      const [line] = await ctx.db
        .select({
          id: invoiceLines.id,
          invoiceId: invoiceLines.invoiceId,
          rawDescription: invoiceLines.rawDescription,
          qtyBilled: invoiceLines.qtyBilled,
          unit: invoiceLines.unit,
          unitPriceBilled: invoiceLines.unitPriceBilled,
          lineTotal: invoiceLines.lineTotal,
          productId: invoiceLines.productId,
        })
        .from(invoiceLines)
        .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, restaurantId)))
        .where(eq(invoiceLines.id, input.lineId))
        .limit(1);
      if (!line) throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice line not found' });
      const inv = await editableInvoice(ctx.db, restaurantId, line.invoiceId);
      await ctx.db.delete(invoiceLines).where(eq(invoiceLines.id, line.id));
      const totals = await recomputeInvoiceTotals(ctx.db, restaurantId, inv);
      const { id: _id, ...gone } = line;
      await recordAudit(ctx.db, {
        restaurantId,
        userId: ctx.session.userId,
        action: 'receiving.invoice_line_deleted',
        entityType: 'invoice_line',
        entityId: line.id,
        before: { invoiceId: inv.id, line: gone, totals: inv.totals },
        after: { invoiceId: inv.id, totals },
      });
      const rematched = await rematchAfterEdit(ctx, inv.id);
      return { ok: true, totals, rematched };
    }),

  /**
   * Begin a goods receipt: creates GR + GR lines mirroring the PO.
   * Idempotent — re-calling returns the existing pending receipt.
   *
   * `reopen` (W1-05): a follow-up delivery for a PARTIAL receipt. One GR per PO, so
   * the same receipt goes back to pending — explicitly, and logged in audit_log —
   * for the rest of the goods to be counted on it. A completed receipt is never
   * reopened; a retried reopen of an already-open receipt is a no-op (not re-logged).
   */
  startReceipt: receiverProcedure
    .input(z.object({ poId: z.string().uuid(), reopen: z.boolean().optional() }))
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
        const gr = existing[0];
        if (!input.reopen || gr.status === 'pending') {
          return { receiptId: gr.id, alreadyExisted: true as const, reopened: false };
        }
        if (gr.status !== 'partial') {
          throw new TRPCError({ code: 'CONFLICT', message: 'רק קבלה חלקית נפתחת להשלמה — הקבלה הזאת נסגרה' });
        }
        // Conditional on 'partial': two taps reopen (and log) once.
        const [reopened] = await ctx.db
          .update(goodsReceipts)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(
            and(
              eq(goodsReceipts.id, gr.id),
              eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
              eq(goodsReceipts.status, 'partial'),
            ),
          )
          .returning({ id: goodsReceipts.id });
        if (reopened) {
          await ctx.db.insert(auditLog).values({
            restaurantId: ctx.session.restaurantId,
            userId: ctx.session.userId,
            action: 'goods_receipt.reopened',
            entityType: 'goods_receipt',
            entityId: gr.id,
            before: { status: 'partial' },
            after: { status: 'pending', reason: 'follow_up_delivery', role: ctx.session.role },
          });
        }
        return { receiptId: gr.id, alreadyExisted: true as const, reopened: !!reopened };
      }

      // Row lock shared with orders.cancelOrder: a receipt never starts on an
      // order that is being (or was) cancelled.
      const po = await ctx.db
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, input.poId),
            eq(purchaseOrders.restaurantId, ctx.session.restaurantId),
          ),
        )
        .limit(1)
        .for('update');
      if (!po[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'PO not found' });
      if (po[0].status === 'cancelled' || po[0].status === 'closed') {
        throw new TRPCError({ code: 'CONFLICT', message: 'ההזמנה בוטלה או נסגרה — אי אפשר לפתוח עליה קבלה' });
      }

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
        return { receiptId: raced.id, alreadyExisted: true as const, reopened: false };
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

      return { receiptId: receipt.id, alreadyExisted: false as const, reopened: false };
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
      // Only an OPEN receipt takes a count: once closed, the counted quantities are
      // the record the match and the supplier claims were made against.
      const next = {
        qtyReceived: input.qtyReceived.toString(),
        qtyRejected: input.qtyRejected.toString(),
        rejectReason: input.rejectReason ?? null,
        conditionNotes:
          input.condition === 'damaged'
            ? `damaged: ${input.conditionNotes ?? ''}`.trim()
            : input.conditionNotes ?? null,
        photos: input.photos ?? [],
      };
      const [updated] = await ctx.db
        .update(grLines)
        .set(next)
        .where(
          and(
            eq(grLines.id, input.grLineId),
            inArray(
              grLines.grId,
              ctx.db
                .select({ id: goodsReceipts.id })
                .from(goodsReceipts)
                .where(
                  and(
                    eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
                    eq(goodsReceipts.status, 'pending'),
                  ),
                ),
            ),
          ),
        )
        .returning();
      if (!updated) {
        // Same tenant scope as above: a foreign line stays NOT_FOUND (no oracle).
        const [own] = await ctx.db
          .select({ line: grLines })
          .from(grLines)
          .innerJoin(goodsReceipts, eq(goodsReceipts.id, grLines.grId))
          .where(and(eq(grLines.id, input.grLineId), eq(goodsReceipts.restaurantId, ctx.session.restaurantId)))
          .limit(1);
        if (!own) throw new TRPCError({ code: 'NOT_FOUND', message: 'GR line not found' });
        // A retry of a mark whose answer was lost (the wizard re-sends its marks before
        // the idempotent submit) changes nothing: hand back the stored line. Only a real
        // change to a closed count is refused.
        if (sameMark(own.line, next)) return own.line;
        throw new TRPCError({ code: 'CONFLICT', message: 'הקבלה כבר נסגרה — אי אפשר לשנות את הספירה' });
      }
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
      // Only CLOSING an open receipt claims scans. Re-submitting a receipt that
      // was already completed/partial must not reach into other (sibling)
      // receipts' held scans — it only re-matches its own runs.
      const [before] = await ctx.db
        .select({ status: goodsReceipts.status })
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.id, input.grId), eq(goodsReceipts.restaurantId, ctx.session.restaurantId)))
        .limit(1);
      const wasOpen = before?.status === 'pending';
      if (before && !wasOpen) {
        // A closed receipt is never re-closed: its status, signature and close time
        // stay as recorded (no flipping completed ↔ partial, no new signature). A
        // retry of a submit whose answer was lost lands here and gets the stored
        // receipt back; only its own runs are re-matched, never a sibling's scans.
        const [closed] = await ctx.db
          .select()
          .from(goodsReceipts)
          .where(and(eq(goodsReceipts.id, input.grId), eq(goodsReceipts.restaurantId, ctx.session.restaurantId)))
          .limit(1);
        if (!closed) throw new TRPCError({ code: 'NOT_FOUND', message: 'GR not found' });
        await rematchAfterCount(ctx.db, ctx.session.restaurantId, closed, [], false);
        return closed;
      }

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
          // DB clock, like match_runs.run_at: the dock slip compares the two (a
          // skewed API clock must not make the post-count run look older).
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(goodsReceipts.id, input.grId),
            eq(goodsReceipts.restaurantId, ctx.session.restaurantId),
          ),
        )
        .returning();
      if (!receipt) throw new TRPCError({ code: 'NOT_FOUND', message: 'GR not found' });
      await rematchAfterCount(ctx.db, ctx.session.restaurantId, receipt, input.invoiceIds ?? [], wasOpen);
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
        /** A deliberate SECOND invoice on this receipt (owner / manager only). */
        additionalInvoice: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Pilot rule: one order = one invoice. Only an owner / manager may put a
      // second invoice on a receipt — a receiver's re-scan resumes the first.
      if (input.additionalInvoice && ctx.session.role !== 'owner' && ctx.session.role !== 'manager') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'רק בעלים או מנהל יכולים להוסיף חשבונית שנייה לקבלה' });
      }
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
      // The scan is stamped with this receipt and claimed only by it: an invoice
      // of another supplier would never pair with it and be orphaned (no run).
      const [grPo] = await ctx.db
        .select({ supplierId: purchaseOrders.supplierId })
        .from(goodsReceipts)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
        .where(and(eq(goodsReceipts.id, input.grId), eq(goodsReceipts.restaurantId, ctx.session.restaurantId)))
        .limit(1);
      if (grPo && grPo.supplierId !== input.supplierId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "supplierId must be the receipt's order supplier" });
      }

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

        // B7: one receipt, one invoice. Re-opening a half-finished receipt and
        // scanning again used to register a SECOND invoice on it (spend + leak
        // doubled, and no UI could remove the copy). Under a per-receipt lock:
        // the receipt's invoice is resumed — unless an owner / manager asks for
        // an additional one. A first scan whose OCR failed (no lines yet) is a
        // retake: the same invoice takes the new photo and is read again.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`register-invoice-gr:${input.grId}`}))`);
        if (!input.additionalInvoice) {
          const [own] = await tx
            .select({ id: invoices.id, ocrPayload: invoices.ocrPayload })
            .from(invoices)
            .where(and(eq(invoices.restaurantId, restaurantId), receiptInvoiceSql(restaurantId, input.grId)))
            .orderBy(asc(invoices.createdAt), asc(invoices.id))
            .limit(1);
          if (own) {
            const failed = (own.ocrPayload?.raw as { ocrFailed?: unknown } | null | undefined)?.ocrFailed === true;
            const [line] = failed
              ? await tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, own.id)).limit(1)
              : [];
            if (!failed || line) return { invoiceId: own.id, created: false as const, resumed: true as const };
            await tx
              .update(invoices)
              .set({
                rawImageUrl: input.imageUrl,
                status: 'ocr_pending',
                ocrConfidence: null,
                ocrPayload: receiptStamp(grPo ? input.grId : undefined),
                updatedAt: new Date(),
              })
              .where(and(eq(invoices.id, own.id), eq(invoices.restaurantId, restaurantId)));
            return { invoiceId: own.id, created: true as const };
          }
        }

        const [row] = await tx
          .insert(invoices)
          .values({
            restaurantId,
            supplierId: input.supplierId,
            rawImageUrl: input.imageUrl,
            status: 'ocr_pending',
            source: 'photo',
            createdBy: ctx.session.userId,
            // The receipt the scan was taken on, from the moment it exists (the
            // OCR job re-stamps it): a re-scan finds it before OCR has run.
            ocrPayload: receiptStamp(grPo ? input.grId : undefined),
          })
          .returning({ id: invoices.id });
        if (!row) throw new Error('failed to register invoice');
        return { invoiceId: row.id, created: true as const };
      });
      if (!outcome.created) {
        return {
          invoiceId: outcome.invoiceId,
          alreadyExisted: true as const,
          ...('resumed' in outcome ? { resumed: true as const } : {}),
        };
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
/** Whether a stored gr_line already holds exactly what a markGrLine would write. */
function sameMark(
  stored: { qtyReceived: string; qtyRejected: string; rejectReason: string | null; conditionNotes: string | null; photos: unknown },
  next: { qtyReceived: string; qtyRejected: string; rejectReason: string | null; conditionNotes: string | null; photos: string[] },
): boolean {
  const photos = Array.isArray(stored.photos) ? (stored.photos as unknown[]) : [];
  return (
    Number(stored.qtyReceived) === Number(next.qtyReceived) &&
    Number(stored.qtyRejected) === Number(next.qtyRejected) &&
    (stored.rejectReason ?? null) === next.rejectReason &&
    (stored.conditionNotes ?? null) === next.conditionNotes &&
    photos.length === next.photos.length &&
    photos.every((p, i) => p === next.photos[i])
  );
}

async function rematchAfterCount(
  db: Database,
  restaurantId: string,
  receipt: { id: string; poId: string | null },
  scanned: string[],
  /** The receipt was open until this submit: only then may it claim waiting / scanned invoices. */
  claimScans: boolean,
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
      const out = new Set<string>();
      if (claimScans) {
        for (const id of await invoicesWaitingOnReceipt(tx, restaurantId, grId)) out.add(id);
        for (const id of await scannedInvoicesForReceipt(tx, restaurantId, receipt, scanned)) out.add(id);
      }
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

/**
 * ocr_payload for a scan registered on a receipt, before OCR: just the receipt
 * stamp (raw.scanGrId — readScanGrId / scanOwnerReceipt). Only a receipt already
 * checked to be this tenant's and this supplier's. The OCR job's own payload
 * replaces it, keeping the stamp (withScanGrId).
 */
function receiptStamp(grId: string | undefined): OcrPayload | null {
  return grId ? { provider: 'claude_vision', raw: { scanGrId: grId } } : null;
}

/**
 * "This invoice is the receipt's" (alias-free, for a WHERE on invoices): stamped
 * with the receipt (raw.scanGrId), held for it alone (raw.heldForReceipts =
 * [grId], a photo), or matched against it (a match run with this gr_id).
 */
function receiptInvoiceSql(restaurantId: string, grId: string) {
  return or(
    sql`${invoices.ocrPayload} -> 'raw' ->> 'scanGrId' = ${grId}`,
    and(
      eq(invoices.source, 'photo'),
      sql`${invoices.ocrPayload} -> 'raw' -> ${sql.raw(`'${HELD_FOR_RECEIPTS_KEY}'`)} = jsonb_build_array(${grId}::text)`,
    ),
    inArray(
      invoices.id,
      sql`(select ${matchRuns.invoiceId} from ${matchRuns} where ${matchRuns.restaurantId} = ${restaurantId} and ${matchRuns.grId} = ${grId})`,
    ),
  );
}

/** The OCR could not read it (raw.ocrFailed), or lines were entered by hand (raw.manualLines). */
function isHandEntered(ocrPayload: OcrPayload | null): boolean {
  const raw = (ocrPayload?.raw ?? null) as { ocrFailed?: unknown; manualLines?: unknown } | null;
  return raw?.ocrFailed === true || raw?.manualLines === true;
}

/** May lines be added / deleted by hand (see editableInvoice)? One rule for the API and the page. */
function linesEditable(status: string, ocrPayload: OcrPayload | null): boolean {
  if (status === 'parsed') return true;
  return isHandEntered(ocrPayload) && (status === 'matched' || status === 'disputed');
}

type OrderLine = {
  id: string;
  rawDescription: string | null;
  productName: string | null;
  productId: string | null;
  supplierSku: string | null;
  qtyOrdered: string;
  unit: string;
  unitPriceExpected: string | null;
};

/**
 * The lines of the order this invoice belongs to: the order of its latest match
 * run, else the order of the receipt it was scanned on (raw.scanGrId).
 * Tenant-scoped; [] when the invoice has no order yet.
 */
async function invoiceOrderLines(
  db: Database,
  restaurantId: string,
  invoiceId: string,
  ocrPayload: OcrPayload | null,
): Promise<OrderLine[]> {
  const [run] = await db
    .select({ poId: matchRuns.poId })
    .from(matchRuns)
    .where(and(eq(matchRuns.invoiceId, invoiceId), eq(matchRuns.restaurantId, restaurantId), isNotNull(matchRuns.poId)))
    .orderBy(desc(matchRuns.runAt))
    .limit(1);
  let poId = run?.poId ?? null;
  const grId = poId ? null : readScanGrId(ocrPayload);
  if (grId) {
    const [gr] = await db
      .select({ poId: goodsReceipts.poId })
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
      .limit(1);
    poId = gr?.poId ?? null;
  }
  if (!poId) return [];
  return db
    .select({
      id: poLines.id,
      rawDescription: poLines.rawDescription,
      productName: products.canonicalName,
      productId: poLines.productId,
      supplierSku: poLines.supplierSku,
      qtyOrdered: poLines.qtyOrdered,
      unit: poLines.unit,
      unitPriceExpected: poLines.unitPriceExpected,
    })
    .from(poLines)
    .innerJoin(purchaseOrders, and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, restaurantId)))
    .leftJoin(products, and(eq(products.id, poLines.productId), eq(products.restaurantId, restaurantId)))
    .where(eq(poLines.poId, poId));
}

/** Description key: no niqqud / quote marks (״ ' "), collapsed spaces, lower case. */
function normDescription(v: string | null | undefined): string {
  return (v ?? '')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/["'\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type LineLink = { productId: string | null; supplierSku: string | null };

/**
 * The product (or, for an unlinked order line, its supplier SKU — the engine's
 * other pairing key) of the ONE order line whose description or product name
 * matches; null when none does, 'ambiguous' when several do (never a guess).
 */
function orderLineByDescription(lines: OrderLine[], description: string): LineLink | null | 'ambiguous' {
  const key = normDescription(description);
  if (!key) return null;
  const hits = lines.filter(
    (l) => (l.productId || l.supplierSku) && (normDescription(l.rawDescription) === key || normDescription(l.productName) === key),
  );
  const distinct = new Set(hits.map((h) => h.productId ?? `sku:${h.supplierSku}`));
  if (distinct.size === 0) return null;
  if (distinct.size > 1) return 'ambiguous';
  const hit = hits[0]!;
  return hit.productId ? { productId: hit.productId, supplierSku: null } : { productId: null, supplierSku: hit.supplierSku };
}

/**
 * A free-text hand line: the invoice's own order first (one matching line);
 * when the name fits several order lines it stays unlinked — the catalogue is
 * never asked to break that tie. Not on the order at all: the catalogue's exact
 * links (catalogProductByName).
 */
async function freeTextLink(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  orderLines: OrderLine[],
  description: string,
): Promise<LineLink | null> {
  const onOrder = orderLineByDescription(orderLines, description);
  if (onOrder === 'ambiguous') return null;
  return onOrder ?? (await catalogProductByName(db, restaurantId, supplierId, description));
}

/**
 * A free-text hand line not on the order: the catalogue's exact links only (the
 * matcher's "auto" cases) — this supplier's alias for the name, else ONE product
 * with exactly this canonical name. Anything fuzzier stays unlinked (a manager
 * maps it; G-08's decideLink takes over this step when it lands).
 */
async function catalogProductByName(
  db: Database,
  restaurantId: string,
  supplierId: string | null,
  name: string,
): Promise<{ productId: string; supplierSku: null } | null> {
  const alias = await matchByAlias(db, restaurantId, supplierId, name);
  if (alias) return { productId: alias.productId, supplierSku: null };
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const hits = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), sql`lower(${products.canonicalName}) = ${lower}`))
    .limit(2);
  return hits.length === 1 ? { productId: hits[0]!.id, supplierSku: null } : null;
}

type InvoiceTotals = { totalExclVat: string | null; vatAmount: string | null; totalInclVat: string | null };

/**
 * The invoice a manual line edit may touch (B8), row-locked: this tenant's, and
 * one the OCR could not read (raw.ocrFailed) or held for a human ('parsed').
 * The re-match after an edit moves it to 'matched' / 'disputed', so a hand-
 * entered invoice is marked (raw.manualLines) and stays editable line by line;
 * the OCR-failed marker survives the re-match as well. Never once approved or
 * paid (money history). A read invoice is corrected with updateInvoiceLine; a
 * foreign / missing id is NOT_FOUND.
 */
async function editableInvoice(db: Database, restaurantId: string, invoiceId: string) {
  const [inv] = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      ocrPayload: invoices.ocrPayload,
      supplierId: invoices.supplierId,
      totalExclVat: invoices.totalExclVat,
      vatAmount: invoices.vatAmount,
      totalInclVat: invoices.totalInclVat,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1)
    .for('update');
  if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
  const handEntered = isHandEntered(inv.ocrPayload);
  if (!linesEditable(inv.status, inv.ocrPayload)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'אפשר להוסיף או למחוק שורות רק בחשבונית שלא נקראה אוטומטית או שממתינה לבדיקה',
    });
  }
  const totals: InvoiceTotals = { totalExclVat: inv.totalExclVat, vatAmount: inv.vatAmount, totalInclVat: inv.totalInclVat };
  return { id: inv.id, supplierId: inv.supplierId, totals, ocrPayload: inv.ocrPayload, handEntered };
}

/**
 * Header totals from the lines, exact: Σ line totals (NUMERIC → integer agorot),
 * VAT = excl × rate (supplier's, else the restaurant's, else 18%) rounded
 * half-up to the agora, incl = excl + VAT; written back as NUMERIC strings.
 */
async function recomputeInvoiceTotals(
  db: Database,
  restaurantId: string,
  inv: { id: string; supplierId: string | null },
): Promise<InvoiceTotals> {
  const lines = await db.select({ lineTotal: invoiceLines.lineTotal }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
  const exclAgorot = lines.reduce((t, l) => t + (numericToAgorot(l.lineTotal) ?? 0), 0);
  const [rest] = await db.select({ vatRate: restaurants.vatRate }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  const [sup] = inv.supplierId
    ? await db
        .select({ vatRate: suppliers.vatRate })
        .from(suppliers)
        .where(and(eq(suppliers.id, inv.supplierId), eq(suppliers.restaurantId, restaurantId)))
        .limit(1)
    : [];
  const rateBp = rateToBasisPoints(sup?.vatRate ?? rest?.vatRate ?? null);
  const vatAgorot = Number((BigInt(exclAgorot) * BigInt(rateBp) + 5_000n) / 10_000n); // half-up (excl ≥ 0)
  const totals: InvoiceTotals = {
    totalExclVat: agorotToPlain(exclAgorot),
    vatAmount: agorotToPlain(vatAgorot),
    totalInclVat: agorotToPlain(exclAgorot + vatAgorot),
  };
  await db
    .update(invoices)
    .set({ ...totals, updatedAt: new Date() })
    .where(and(eq(invoices.id, inv.id), eq(invoices.restaurantId, restaurantId)));
  return totals;
}

/** A VAT rate as a NUMERIC string ("0.18", "0.1700") → basis points (1800); none → 18%. */
function rateToBasisPoints(rate: string | null): number {
  if (rate == null) return 1800;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) return 1800;
  return Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0').slice(0, 4));
}

/** A non-negative number → a fixed-scale decimal string (NUMERIC), no float noise. */
function decimalString(n: number, scale: number): string {
  return n.toFixed(scale);
}

/**
 * Re-match after a manual line edit — through match.runForInvoice itself (its
 * consolidated / claims-in-progress guards included), in a savepoint: a refused
 * re-match never undoes the edit; the caller reports it (rematched: false).
 */
async function rematchAfterEdit(ctx: { db: Database; session: MemberSession }, invoiceId: string): Promise<boolean> {
  try {
    await ctx.db.transaction(async (sp) => {
      await matchRouter.createCaller({ db: sp as unknown as Database, session: ctx.session }).runForInvoice({ invoiceId });
    });
    return true;
  } catch (err) {
    console.warn(`[receiving] re-match after a manual line edit was refused for invoice=${invoiceId}`, err);
    return false;
  }
}
