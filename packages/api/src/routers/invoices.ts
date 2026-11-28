import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  and,
  asc,
  desc,
  discrepancies,
  eq,
  goodsReceipts,
  grLines,
  poLines,
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
  type UserRole,
} from '@restomatch/db';
import { can, financeProcedure, invoiceReaderProcedure, router } from '../trpc';
import { canViewPrices } from '../lib/capabilities';
import { readDuplicateOf } from '../lib/invoiceDedupe';
import { readConsolidatedRaw } from '../match/consolidated';
import { closedReceiptSql, countedLineSql } from '../match/receiptTruth';
import { localDateKeyInTz } from '../lib/time';
import { allocationThreshold } from '../vat/vatAtRisk';
import {
  INVOICE_STATES,
  invoiceStateOf,
  invoiceStatesForMonth,
  type InvoiceState,
  type InvoiceStateRow,
} from '../invoices/state';
import {
  HOLDING_MAX_IDS,
  gapRoleOf,
  isQueueRow,
  leadingRolesFor,
  placeOf,
  reasonOfRule,
  type DecisionRecord,
  type GapReason,
  type GapRole,
  type Holding,
  type InvoiceHoldingEntry,
  type PassedOn,
  type PlaceId,
  type PlaceSummary,
} from '../invoices/holding';
import type { Allocation, PayBy, Payment } from '../invoices/payment';
import type { InvoiceHistory } from '../invoices/history';

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
 *
 * `needsLines` (pilot #222) stays: it feeds the home "מחכה לך" row and the
 * cockpit's held-invoice banner.
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
  /** The allocation number as stored (shown in the register), or null. */
  allocationNumber: string | null;
  /** The invoice is above the allocation threshold for its date (VAT rule): a missing number is a real gap. */
  allocationRequired: boolean;
  consolidated: boolean;
}

/**
 * INV-00 · an `invoices.list` row: the register row plus the facts every screen of the
 * invoices area reads from one definition (`invoices/holding.ts`, `invoices/payment.ts`).
 */
export interface InvoiceListRow extends RegisterRow {
  /** With whom its open gaps are, since when and why; null when it has no open gap. */
  holding: Holding | null;
  /** The last decision a person took on one of its gaps; null when none (what the system closed is never one). */
  lastDecision: DecisionRecord | null;
  /** Its place in the month, for the caller's role (every invoice in exactly one place). */
  place: PlaceId;
  /** The pay run holds it for a missing or malformed allocation number (`vatAtRisk()`), the pay run's own rule. */
  allocationMissing: boolean;
  /** The pay run's date (`computeDueDate`), or null when it is unknown. `dueDate` stays the date a person typed. */
  payBy: PayBy | null;
}

/** Israel calendar day of an invoice date (the VAT threshold is by invoice date). */
const IL_TZ = 'Asia/Jerusalem';
export function allocationRequiredFor(invoiceDate: Date | string | null, totalExclVat: string | number | null): boolean {
  if (!invoiceDate || totalExclVat == null) return false;
  const threshold = allocationThreshold(localDateKeyInTz(new Date(invoiceDate), IL_TZ));
  return threshold != null && Number(totalExclVat) > threshold;
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
      totalExclVat: invoices.totalExclVat,
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
      allocationNumber: hasAllocation(m.allocationNumber) ? m.allocationNumber!.trim() : null,
      allocationRequired: allocationRequiredFor(m.invoiceDate, m.totalExclVat),
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

function countTabs(
  rows: readonly RegisterRow[],
  intake: number,
  allocationMissing: number,
): Record<RegisterTab, number> & { allocationMissing: number } {
  const out = Object.fromEntries(REGISTER_TABS.map((t) => [t, 0])) as Record<RegisterTab, number>;
  for (const r of rows) {
    out[r.tab] += 1;
    if (!r.hasAllocation && r.state !== 'in_ocr') out.noAllocation += 1;
  }
  out.intake = intake;
  // INV-00: `noAllocation` keeps its value (every invoice with no number); this one counts the
  // rows the pay run holds for a missing number (`allocationMissing`, decision 5).
  return { ...out, allocationMissing };
}

/**
 * INV-00 · the list rows' new facts. Contract (slice 0): the place from the canonical state
 * and the leading open gap's role; `holding`, `lastDecision`, `payBy` and `places` empty.
 */
async function listRowsOf(
  db: Parameters<typeof invoiceStatesForMonth>[0],
  session: { restaurantId: string; role: UserRole },
  rows: readonly RegisterRow[],
): Promise<{ rows: InvoiceListRow[]; places: PlaceSummary[]; allocationMissing: number }> {
  const held = rows.filter((r) => r.state === 'flagged_open' || r.state === 'held_duplicate').map((r) => r.id);
  const roles = await leadingRolesFor(db, session.restaurantId, session.role, held);
  return {
    rows: rows.map((r) => ({
      ...r,
      holding: null,
      lastDecision: null,
      place: placeOf(r.state, roles.get(r.id) ?? null, false),
      allocationMissing: false,
      payBy: null,
    })),
    places: [],
    allocationMissing: 0,
  };
}

const MonthInput = z.object({ monthOffset: z.number().int().min(-24).max(0).default(0) }).default({});


export type NeedsLinesReason = 'ocr_failed' | 'no_lines' | 'held';

/**
 * Codes that never make an invoice "waiting for you" on their own:
 * - link codes belong to G-08's "ממתינות לשיוך" question flow (#200);
 * - 'consolidated' is S13's MARKER on every חשבונית מרכזת, not an action — a
 *   consolidated invoice is listed only with an actionable code next to it.
 * Dropped from a mixed hold's reasons too. Mirrored in SQL by `actionableHold`.
 */
export const NON_ACTION_HOLD_CODES: readonly string[] = ['unlinked', 'unlinkedPo', 'consolidated'];
const NON_ACTION = new Set(NON_ACTION_HOLD_CODES);

/**
 * The non-link review reasons S13's pipeline wrote on a held invoice
 * (`ocr_payload.raw.reviewReasons`). Read loosely: strings, or objects with a
 * `code`; anything else is ignored. Deduplicated, order kept.
 */
export function holdReasonsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    const code = typeof r === 'string' ? r : r && typeof r === 'object' && typeof (r as { code?: unknown }).code === 'string' ? (r as { code: string }).code : null;
    if (code && !NON_ACTION.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export interface NeedsLinesRow {
  id: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceDate: Date | null;
  invoiceNumber: string | null;
  /** For the "supplier details" link on supplier_id_mismatch (an id, never ₪). */
  supplierId: string | null;
  reason: NeedsLinesReason;
  /** The actionable review reason codes (S13 #224), e.g. supplier_id_mismatch, doc_kind_receipt — on any row (extra chips). */
  reviewReasons: string[];
}

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
      const area = await listRowsOf(
        ctx.db,
        ctx.session,
        await registerRows(ctx.db, ctx.session.restaurantId, input.monthOffset),
      );
      const rows = area.rows;
      const visible = !input.tab
        ? rows
        : input.tab === 'noAllocation'
          ? rows.filter((r) => !r.hasAllocation && r.state !== 'in_ocr')
          : input.tab === 'intake'
            ? []
            : rows.filter((r) => r.tab === input.tab);
      return {
        rows: visible,
        counts: countTabs(rows, await intakeCount(ctx.db, ctx.session.restaurantId), area.allocationMissing),
        /** Σ visible rows, integer agorot (the TotalsRow). */
        totals: {
          totalInclVatAgorot: visible.reduce((s, r) => s + r.totalInclVatAgorot, 0),
          gapAgorot: visible.reduce((s, r) => s + r.gapAgorot, 0),
        },
        /**
         * INV-00 · the places of the month for the caller's role, every place with its count (zeros
         * included), in the order of PLACE_IDS; the screens order them (`apps/web/lib/invoices/places.ts`).
         * They partition the month (all rows, whatever `tab` filtered).
         */
        places: area.places,
      };
    }),

  /** Tab counts only (nav badge / ViewTabs). Same partition as `list`. */
  counts: can('money.view')
    .input(MonthInput)
    .query(async ({ ctx, input }) => {
      const area = await listRowsOf(
        ctx.db,
        ctx.session,
        await registerRows(ctx.db, ctx.session.restaurantId, input.monthOffset),
      );
      return countTabs(area.rows, await intakeCount(ctx.db, ctx.session.restaurantId), area.allocationMissing);
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
        poDate: sql<Date | null>`COALESCE(${purchaseOrders.expectedDeliveryAt}, ${purchaseOrders.createdAt})`,
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
            // INV-00: the routing facts of each finding (no ₪, no name).
            requiresRole: discrepancies.requiresRole,
            ruleId: discrepancies.ruleId,
            createdAt: discrepancies.createdAt,
          })
          .from(discrepancies)
          .where(and(eq(discrepancies.matchRunId, run.id), eq(discrepancies.restaurantId, rid)))
          .orderBy(asc(discrepancies.createdAt))
      : [];

    // The three-way columns: ordered (PO line) and received (receipt line) per product.
    const ordered = run?.poId
      ? await ctx.db
          .select({ productId: poLines.productId, qty: poLines.qtyOrdered, price: poLines.unitPriceExpected })
          .from(poLines)
          .innerJoin(purchaseOrders, and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.restaurantId, rid)))
          .where(eq(poLines.poId, run.poId))
      : [];
    const received = run?.grId
      ? await ctx.db
          .select({
            productId: sql<string | null>`COALESCE(${grLines.productId}, ${poLines.productId})`,
            qty: grLines.qtyReceived,
            rejected: grLines.qtyRejected,
            // G-04 Q3: the same "closed receipt" / "counted line" truth the engine reads.
            closed: sql<boolean>`${closedReceiptSql()}`,
            counted: sql<boolean>`${countedLineSql()}`,
          })
          .from(grLines)
          .innerJoin(goodsReceipts, and(eq(goodsReceipts.id, grLines.grId), eq(goodsReceipts.restaurantId, rid)))
          .leftJoin(poLines, eq(poLines.id, grLines.poLineId))
          .where(eq(grLines.grId, run.grId))
      : [];
    const sumBy = <T extends { productId: string | null }>(rows: T[], f: (r: T) => number, pid: string | null) =>
      pid == null || !rows.some((r) => r.productId === pid)
        ? null
        : rows.filter((r) => r.productId === pid).reduce((a, r) => a + f(r), 0);

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
        // INV-00 · an undecided gap (one of the approvals queue's rows: open or escalated, not
        // the ₪0 twin): the role it waits for, its rule and since when. A decided one: the
        // decision. All null without money.view (the receiver reads this procedure).
        routing: (money && isQueueRow(f) ? gapRoleOf(f.requiresRole) : null) as GapRole | null,
        reason: (money && isQueueRow(f) ? reasonOfRule(f.ruleId, f.type) : null) as GapReason | null,
        since: (money && isQueueRow(f) ? f.createdAt : null) as Date | null,
        passedOn: null as PassedOn | null,
        decision: null as DecisionRecord | null,
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
        qtyOrdered: sumBy(ordered, (r) => Number(r.qty), l.productId),
        qtyReceived: sumBy(received, (r) => Number(r.qty) - Number(r.rejected ?? 0), l.productId),
        /**
         * G-04 Q3 (owner 11.11): the receipt is closed but nobody counted this product's
         * line(s), so there is no quantity check on it (§5.2). Read-only, neutral, no ₪.
         */
        notCounted:
          l.productId != null &&
          received.some((r) => r.productId === l.productId) &&
          received.filter((r) => r.productId === l.productId).every((r) => r.closed === true && r.counted !== true),
        expectedPrice: money ? num(ordered.find((r) => r.productId === l.productId && l.productId != null)?.price ?? null) : null,
        expectedPriceSource: ordered.some((r) => r.productId === l.productId && l.productId != null) ? ('po_price' as const) : null,
        expectedPriceAt: run?.poDate ?? null,
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
      // ── INV-00 · every new field is null without money.view (the receiver reads this). ──
      /** With whom its open gaps are, since when and why (as on the list row); null when none is open. */
      holding: null as Holding | null,
      /** The rows the approvals desk shows for this invoice (`openCount` also counts the ₪0 twin and keeps its value). */
      queueOpenCount: null as number | null,
      /** Held, payable, paid or being read, in the pay run's terms, with the reasons. */
      payment: null as Payment | null,
      /** The allocation number: required, the number, valid, missing (the pay run's rule), the VAT at risk. */
      allocation: null as Allocation | null,
      /** The pay run's date (`computeDueDate`), or null when unknown. */
      payBy: null as PayBy | null,
      /** When the order of the latest match run was sent to the supplier. */
      orderSentAt: null as Date | null,
    };
  }),
  /**
   * This restaurant's invoices that need lines from a person: the read failed
   * (`ocr_payload.raw.ocrFailed`), or a scanned invoice (photo / e-mail /
   * WhatsApp — the ones OCR reads) came out with 0 lines. A typed or
   * platform-imported invoice was never "read", so 0 lines there is not this list. Not
   * while OCR is still reading, not paid, never a חשבונית מרכזת (cross-matched
   * against its delivery notes, not itemised). Owner, manager, bookkeeper only.
   *
   * Also every HELD invoice (status `parsed` with ≥1 actionable `reviewReasons`
   * code — S13 #224), so no invoice sits held without the owner knowing why.
   * A failed read is listed only while it still has no lines (a person may have
   * typed them, #216). Precedence: ocr_failed > no_lines > held; the actionable
   * reasons ride along on every row as extra chips. The whole filter runs in SQL
   * (before LIMIT), so link-only / marker-only holds never crowd the page. No ₪.
   */
  needsLines: financeProcedure.query(async ({ ctx }): Promise<{ count: number; rows: NeedsLinesRow[] }> => {
    const rid = ctx.session.restaurantId;
    const failed = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'ocrFailed') = 'true', false)`;
    const noLines = sql<boolean>`NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = ${invoices.id})`;
    const consolidated = sql<boolean>`COALESCE((${invoices.ocrPayload} -> 'raw' ->> 'kind') = 'consolidated', false)`;
    const scannedNoLines = sql<boolean>`(NOT ${consolidated} AND ${invoices.status} <> 'ocr_pending' AND ${invoices.source} IN ('photo', 'email', 'whatsapp') AND ${noLines})`;
    // ≥1 actionable review code (strings or {code: string}, non-empty — as holdReasonsOf); link codes and the 'consolidated' marker don't count.
    const reasonsJson = sql`${invoices.ocrPayload} -> 'raw' -> 'reviewReasons'`;
    const actionableHold = sql<boolean>`(CASE WHEN jsonb_typeof(${reasonsJson}) = 'array' THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(${reasonsJson}) e
      WHERE (CASE
          WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}'
          WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'code') = 'string' THEN e ->> 'code'
        END) NOT IN (${sql.join(NON_ACTION_HOLD_CODES.map((c) => sql`${c}`), sql`, `)})
    ) ELSE false END)`;
    const rows = await ctx.db
      .select({
        id: invoices.id,
        supplierName: suppliers.name,
        supplierNameEn: suppliers.nameEn,
        invoiceDate: invoices.invoiceDate,
        invoiceNumber: invoices.invoiceNumber,
        supplierId: invoices.supplierId,
        failed,
        lineless: sql<boolean>`(${noLines})`,
        reviewReasons: sql<unknown>`${invoices.ocrPayload} -> 'raw' -> 'reviewReasons'`,
        unreadLines: sql<boolean>`(${scannedNoLines})`,
        parsed: sql<boolean>`(${invoices.status} = 'parsed')`,
      })
      .from(invoices)
      .leftJoin(suppliers, and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, rid)))
      .where(
        and(
          eq(invoices.restaurantId, rid),
          sql`${invoices.status} <> 'paid'`,
          sql`(
            (${failed} AND ${noLines})
            OR ${scannedNoLines}
            OR (${invoices.status} = 'parsed' AND ${actionableHold})
          )`,
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(200);
    const out: NeedsLinesRow[] = [];
    for (const { failed: f, lineless, reviewReasons: rr, unreadLines, parsed, ...r } of rows) {
      const reasons = parsed ? holdReasonsOf(rr) : [];
      if (f && lineless) out.push({ ...r, reason: 'ocr_failed', reviewReasons: reasons });
      else if (unreadLines) out.push({ ...r, reason: 'no_lines', reviewReasons: reasons });
      else if (reasons.length > 0) out.push({ ...r, reason: 'held', reviewReasons: reasons });
    }
    return { count: out.length, rows: out };
  }),

  /**
   * INV-00 · `holding` and `lastDecision` for the given invoices, in one read (the pay run asks
   * for every row it lists, in chunks of HOLDING_MAX_IDS). One entry per id that is the caller's;
   * a foreign or unknown id is simply absent. Purchase ₪ → `money.view`.
   */
  holding: can('money.view')
    .input(z.object({ invoiceIds: z.array(z.string().uuid()).max(HOLDING_MAX_IDS) }))
    .query(async (): Promise<InvoiceHoldingEntry[]> => {
      // Contract (slice 0): no entry yet.
      return [];
    }),

  /**
   * INV-00 · an invoice's story, newest first: the order, the receipt, the reading, each check,
   * the routing with its rule, each pass-on, decision and undo. Roles only: no user id, name or
   * e-mail; "it was you" is a flag. A foreign or unknown id → NOT_FOUND.
   */
  history: can('money.view')
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<InvoiceHistory> => {
      const [own] = await ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.restaurantId, ctx.session.restaurantId)))
        .limit(1);
      if (!own) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
      // Contract (slice 0): an empty story.
      return { events: [], rematched: false };
    }),
});

export { INVOICE_STATES };
