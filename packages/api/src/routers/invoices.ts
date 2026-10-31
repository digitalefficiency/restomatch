import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  desc,
  discrepancies,
  eq,
  goodsReceipts,
  ingestDocuments,
  inArray,
  invoiceLines,
  invoices,
  matchRuns,
  products,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
} from '@restomatch/db';
import { can, invoiceReaderProcedure, router } from '../trpc';
import { canViewPrices } from '../lib/capabilities';
import { readDuplicateOf } from '../lib/invoiceDedupe';
import { readConsolidatedRaw } from '../match/consolidated';
import {
  INVOICE_STATES,
  invoiceStateOf,
  invoiceStatesForMonth,
  type InvoiceState,
  type InvoiceStateRow,
} from '../invoices/state';

/**
 * Invoice register, cockpit and intake (wave 2, W2-02).
 *
 * The register reads G-05's ONE canonical invoice state (`invoices/state.ts`)
 * and never derives its own: "matched" means a match run exists, never
 * `invoices.status = 'matched'` (OCR writes that before any match).
 *
 * Tabs partition the nine states (every invoice in exactly one tab) and line up
 * with the pay-run buckets and the hero (see invoices-register.test.ts):
 *   review   לבדיקה           flagged_open
 *   awaiting ממתינות לשיוך    awaiting_link | in_ocr          (= hero pendingLinkCount, T4; pay-run "link")
 *   matched  הותאמו           clean | approved | claim_open   (= pay-run "pay" + "claim")
 *   held     בהשהיה           awaiting_count | held_duplicate (+ flagged_open = pay-run "hold")
 *   paid     שולמו            paid
 * plus two cross-cuts: noAllocation (ללא מספר הקצאה) and intake (נכנסות: the
 * intake documents still waiting for a person, from the inbox).
 */

export const REGISTER_TABS = ['review', 'awaiting', 'matched', 'held', 'paid', 'noAllocation', 'intake'] as const;
export type RegisterTab = (typeof REGISTER_TABS)[number];

type StateTab = 'review' | 'awaiting' | 'matched' | 'held' | 'paid';

/** The tab of each canonical state — a total map, so a new G-05 state fails typecheck here. */
export const TAB_OF_STATE: Readonly<Record<InvoiceState, StateTab>> = {
  flagged_open: 'review',
  awaiting_link: 'awaiting',
  in_ocr: 'awaiting',
  clean: 'matched',
  approved: 'matched',
  claim_open: 'matched',
  awaiting_count: 'held',
  held_duplicate: 'held',
  paid: 'paid',
};

export const TAB_STATES: Readonly<Record<StateTab, ReadonlyArray<InvoiceState>>> = Object.fromEntries(
  (['review', 'awaiting', 'matched', 'held', 'paid'] as const).map((tab) => [
    tab,
    INVOICE_STATES.filter((st) => TAB_OF_STATE[st] === tab),
  ]),
) as unknown as Record<StateTab, ReadonlyArray<InvoiceState>>;

/** The tab an invoice state belongs to (the partition above). */
export function tabOfState(state: InvoiceState): StateTab {
  return TAB_OF_STATE[state];
}

const agorot = (ils: number | string | null | undefined) => Math.round(Number(ils ?? 0) * 100);
const hasAllocation = (n: string | null) => !!n && n.trim().length > 0;

export interface RegisterRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  supplierId: string | null;
  supplierName: string | null;
  totalInclVatAgorot: number;
  /** The hero's per-invoice leak (G-05 `leakIls`), integer agorot. */
  gapAgorot: number;
  state: InvoiceState;
  tab: StateTab;
  hasAllocation: boolean;
  consolidated: boolean;
}

async function registerRows(
  db: Parameters<typeof invoiceStatesForMonth>[0],
  restaurantId: string,
  monthOffset: number,
  now?: Date,
): Promise<RegisterRow[]> {
  const states = await invoiceStatesForMonth(db, restaurantId, { monthOffset, now });
  if (states.length === 0) return [];
  const byId = new Map<string, InvoiceStateRow>(states.map((s) => [s.invoiceId, s]));
  const meta = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      supplierId: invoices.supplierId,
      supplierName: suppliers.name,
      allocationNumber: invoices.allocationNumber,
      ocrPayload: invoices.ocrPayload,
    })
    .from(invoices)
    .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, restaurantId)))
    .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, [...byId.keys()])))
    .orderBy(desc(invoices.invoiceDate), asc(invoices.id));
  return meta.map((m) => {
    const s = byId.get(m.id)!;
    return {
      id: m.id,
      invoiceNumber: m.invoiceNumber,
      invoiceDate: m.invoiceDate,
      dueDate: m.dueDate,
      supplierId: m.supplierId,
      supplierName: m.supplierName,
      totalInclVatAgorot: agorot(s.totalInclVat),
      gapAgorot: agorot(s.leakIls),
      state: s.state,
      tab: tabOfState(s.state),
      hasAllocation: hasAllocation(m.allocationNumber),
      consolidated: readConsolidatedRaw(m.ocrPayload) !== null,
    };
  });
}

async function intakeCount(db: Parameters<typeof invoiceStatesForMonth>[0], restaurantId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ingestDocuments)
    .where(and(eq(ingestDocuments.restaurantId, restaurantId), eq(ingestDocuments.status, 'needs_review')));
  return Number(r?.n ?? 0);
}

function countTabs(rows: readonly RegisterRow[], intake: number): Record<RegisterTab, number> {
  const out = Object.fromEntries(REGISTER_TABS.map((t) => [t, 0])) as Record<RegisterTab, number>;
  for (const r of rows) {
    out[r.tab] += 1;
    if (!r.hasAllocation && r.state !== 'in_ocr') out.noAllocation += 1;
  }
  out.intake = intake;
  return out;
}

const MonthInput = z.object({ monthOffset: z.number().int().min(-24).max(0).default(0) }).default({});

export const invoicesRouter = router({
  /**
   * The register: every invoice of the month with its canonical state. Purchase
   * ₪ → `money.view` (owner, manager, bookkeeper); never the receiver or chef.
   */
  list: can('money.view')
    .input(
      z
        .object({
          monthOffset: z.number().int().min(-24).max(0).default(0),
          tab: z.enum(REGISTER_TABS).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const rows = await registerRows(ctx.db, ctx.session.restaurantId, input.monthOffset);
      const visible = !input.tab
        ? rows
        : input.tab === 'noAllocation'
          ? rows.filter((r) => !r.hasAllocation && r.state !== 'in_ocr')
          : input.tab === 'intake'
            ? []
            : rows.filter((r) => r.tab === input.tab);
      return {
        rows: visible,
        counts: countTabs(rows, await intakeCount(ctx.db, ctx.session.restaurantId)),
        /** Σ visible rows, integer agorot (the TotalsRow). */
        totals: {
          totalInclVatAgorot: visible.reduce((s, r) => s + r.totalInclVatAgorot, 0),
          gapAgorot: visible.reduce((s, r) => s + r.gapAgorot, 0),
        },
      };
    }),

  /** Tab counts only (nav badge / ViewTabs). Same partition as `list`. */
  counts: can('money.view')
    .input(MonthInput)
    .query(async ({ ctx, input }) => {
      const rows = await registerRows(ctx.db, ctx.session.restaurantId, input.monthOffset);
      return countTabs(rows, await intakeCount(ctx.db, ctx.session.restaurantId));
    }),

  /**
   * The cockpit: header, canonical state, PO / receipt refs, and every invoice
   * line joined to its findings (expected + source, actual, Δ₪, tolerance as
   * persisted). Receiver: no ₪ / price fields (G-07 price.view). Chef: FORBIDDEN.
   */
  detail: invoiceReaderProcedure.input(z.object({ invoiceId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const rid = ctx.session.restaurantId;
    const [inv] = await ctx.db
      .select({
        id: invoices.id,
        status: invoices.status,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        dueDate: invoices.dueDate,
        supplierId: invoices.supplierId,
        supplierName: suppliers.name,
        supplierNameEn: suppliers.nameEn,
        totalExclVat: invoices.totalExclVat,
        vatAmount: invoices.vatAmount,
        totalInclVat: invoices.totalInclVat,
        allocationNumber: invoices.allocationNumber,
        ocrConfidence: invoices.ocrConfidence,
        ocrPayload: invoices.ocrPayload,
        hasImage: sql<boolean>`${invoices.rawImageUrl} IS NOT NULL OR ${invoices.rawPdfUrl} IS NOT NULL`,
        restaurantVat: restaurants.vatRate,
      })
      .from(invoices)
      .innerJoin(restaurants, eq(restaurants.id, invoices.restaurantId))
      .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, rid)))
      .limit(1);
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });

    const state = await invoiceStateOf(ctx.db, rid, inv.id);
    const [run] = await ctx.db
      .select({
        id: matchRuns.id,
        runAt: matchRuns.runAt,
        overallStatus: matchRuns.overallStatus,
        poId: matchRuns.poId,
        grId: matchRuns.grId,
        poCustomerRef: purchaseOrders.customerRef,
        poVat: purchaseOrders.vatRate,
        grReceivedAt: goodsReceipts.receivedAt,
      })
      .from(matchRuns)
      .leftJoin(purchaseOrders, and(eq(purchaseOrders.id, matchRuns.poId), eq(purchaseOrders.restaurantId, rid)))
      .leftJoin(goodsReceipts, and(eq(goodsReceipts.id, matchRuns.grId), eq(goodsReceipts.restaurantId, rid)))
      .where(and(eq(matchRuns.invoiceId, inv.id), eq(matchRuns.restaurantId, rid)))
      .orderBy(desc(matchRuns.runAt))
      .limit(1);

    const lines = await ctx.db
      .select({
        id: invoiceLines.id,
        productId: invoiceLines.productId,
        productName: products.canonicalName,
        rawDescription: invoiceLines.rawDescription,
        qtyBilled: invoiceLines.qtyBilled,
        unit: invoiceLines.unit,
        unitPriceBilled: invoiceLines.unitPriceBilled,
        lineTotal: invoiceLines.lineTotal,
        ocrConfidenceLine: invoiceLines.ocrConfidenceLine,
      })
      .from(invoiceLines)
      .leftJoin(products, and(eq(products.id, invoiceLines.productId), eq(products.restaurantId, rid)))
      .where(eq(invoiceLines.invoiceId, inv.id))
      .orderBy(asc(invoiceLines.id));

    const findings = run
      ? await ctx.db
          .select({
            id: discrepancies.id,
            type: discrepancies.type,
            severity: discrepancies.severity,
            invoiceLineId: discrepancies.invoiceLineId,
            productId: discrepancies.productId,
            expectedValue: discrepancies.expectedValue,
            actualValue: discrepancies.actualValue,
            deltaAmount: discrepancies.deltaAmount,
            toleranceUsed: discrepancies.toleranceUsed,
            resolutionStatus: discrepancies.resolutionStatus,
          })
          .from(discrepancies)
          .where(and(eq(discrepancies.matchRunId, run.id), eq(discrepancies.restaurantId, rid)))
          .orderBy(asc(discrepancies.createdAt))
      : [];

    const money = canViewPrices(ctx.session.role);
    const num = (v: string | null) => (v == null ? null : Number(v));
    const priceOrNull = (v: string | null) => (money ? num(v) : null);
    // The source of an "expected" figure: the PO price (a run with a PO) or the receipt count.
    const expectedSource = (type: string) =>
      /PRICE|CONTRACT/.test(type) ? 'po_price' : /QTY|SHORT|OVER|MISSING|UNORDERED|RECEIV/.test(type) ? 'receipt' : 'invoice';
    const findingOut = (f: (typeof findings)[number]) => {
      const priceLike = /PRICE|TOTAL|VAT|CONTRACT/.test(f.type);
      return {
        id: f.id,
        type: f.type,
        severity: f.severity,
        resolutionStatus: f.resolutionStatus,
        expected: priceLike ? priceOrNull(f.expectedValue) : num(f.expectedValue),
        actual: priceLike ? priceOrNull(f.actualValue) : num(f.actualValue),
        expectedSource: expectedSource(f.type),
        expectedAt: run?.runAt ?? null,
        deltaAgorot: money && f.deltaAmount != null ? agorot(f.deltaAmount) : null,
        toleranceUsed: f.toleranceUsed,
      };
    };

    // A finding sits on its invoice line; older runs carry only the product — then
    // the (single) invoice line of that product.
    const lineOf = (f: (typeof findings)[number]): string | null => {
      if (f.invoiceLineId && lines.some((l) => l.id === f.invoiceLineId)) return f.invoiceLineId;
      if (!f.productId) return null;
      const same = lines.filter((l) => l.productId === f.productId);
      return same.length === 1 ? same[0]!.id : null;
    };
    const dup = readDuplicateOf(inv.ocrPayload);
    const vatRate = num(run?.poVat ?? null) ?? num(inv.restaurantVat);
    const types = new Set(findings.map((f) => f.type));
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      supplierId: inv.supplierId,
      supplierName: inv.supplierName,
      supplierNameEn: inv.supplierNameEn,
      state: state?.state ?? null,
      consolidated: readConsolidatedRaw(inv.ocrPayload) !== null,
      duplicateOf: dup ? { invoiceNumber: dup.invoiceNumber } : null,
      hasAllocation: hasAllocation(inv.allocationNumber),
      hasImage: inv.hasImage === true,
      ocrConfidence: num(inv.ocrConfidence),
      totalExclVatAgorot: money && inv.totalExclVat != null ? agorot(inv.totalExclVat) : null,
      vatAgorot: money && inv.vatAmount != null ? agorot(inv.vatAmount) : null,
      totalInclVatAgorot: money && inv.totalInclVat != null ? agorot(inv.totalInclVat) : null,
      gapAgorot: money ? agorot(state?.leakIls ?? 0) : null,
      /** The VAT rate the engine used (the PO's, else the restaurant's) — never a UI constant. */
      vatRate,
      /** From the persisted run: lines = before VAT, and VAT, both ✓ unless the engine flagged them. */
      reconciliation: run
        ? { linesMatchSubtotal: !types.has('TOTAL_MISMATCH'), vatMatches: !types.has('VAT_MISMATCH') }
        : null,
      match: run
        ? {
            runAt: run.runAt,
            overallStatus: run.overallStatus,
            poId: run.poId,
            poRef: run.poCustomerRef,
            grId: run.grId,
            grReceivedAt: run.grReceivedAt,
          }
        : null,
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        name: l.productName ?? l.rawDescription,
        rawDescription: l.rawDescription,
        qtyBilled: Number(l.qtyBilled),
        unit: l.unit,
        unitPriceBilled: priceOrNull(l.unitPriceBilled),
        lineTotalAgorot: money ? agorot(l.lineTotal) : null,
        ocrConfidenceLine: num(l.ocrConfidenceLine),
        findings: findings.filter((f) => lineOf(f) === l.id).map(findingOut),
      })),
      /** Findings that sit on no invoice line (missing on invoice, totals, duplicate). */
      headerFindings: findings.filter((f) => lineOf(f) === null).map(findingOut),
      openCount: findings.filter((f) => f.resolutionStatus === 'open' || f.resolutionStatus === 'escalated').length,
      openGapAgorot: money
        ? findings
            .filter((f) => f.resolutionStatus === 'open' || f.resolutionStatus === 'escalated')
            .reduce((s, f) => s + Math.abs(agorot(f.deltaAmount)), 0)
        : null,
    };
  }),
});

export { INVOICE_STATES };
