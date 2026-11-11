import { AWAITING_QUESTION_SQL } from './awaiting-question';
import { sql, type Database } from '@restomatch/db';
import { scanAwaitingCountSql } from './awaiting-count';
import { LEAK_FILTER, LIVE_DUPLICATE, lineFilter, originalChecked, viewInvoicesSql, type ViewSpec } from './leak-views';

/**
 * The owner's 10-second story: "₪X leaked this month, Y% of spend, Z caught
 * before payment" — plus the drill-down to the invoices and lines behind X.
 *
 * Rules (each one is about the number being BELIEVABLE, not big):
 *  • Month = the restaurant's local calendar month (restaurants.timezone), by
 *    invoice date (falls back to created_at) — the same basis as the spend.
 *  • Leak = Σ|delta| of warn/block discrepancies on the invoice's match run.
 *    Excluded: `info` (inside tolerance bands), PRICE_LOWER (the supplier
 *    under-charged — that's not a leak) and UNORDERED_ARRIVAL (no PO found:
 *    typically a consolidated חשבונית ריכוז or a late/early invoice — shown
 *    calmly as "waiting for a PO link", never as a false alarm), and a
 *    DUPLICATE_INVOICE the bookkeeper rejected as "not a duplicate".
 *  • Per invoice the leak is capped at the invoice total: you cannot lose more
 *    on an invoice than the invoice itself (stacked DUPLICATE + line findings).
 *  • Spend = Σ total_excl_vat of the month's CHECKED invoices (matched to a PO),
 *    so "% of spend" is leak ÷ the spend it was measured on. Invoices not yet
 *    linked to a PO (unmatched / consolidated) are "pending": in neither. A
 *    live duplicate copy is leak but not spend when its original is checked
 *    spend (its goods are already counted there).
 *  • Caught before payment = leak on invoices not yet marked paid.
 *  • Recovered = the part of the leak the team accepted as a claim
 *    (resolution accepted/resolved) — same cap.
 *  • A receiving scan the OCR held for its receipt's count (#94 — photo taken,
 *    count not submitted yet) is "waiting for the count" (awaitingCount*), not
 *    "waiting for a PO link": it is bound to its order already. Still in neither
 *    leak nor spend (no run yet). See awaiting-count.ts.
 */

export interface LeakHero {
  /** Local-month bounds as UTC ISO instants: [monthStart, monthEnd). */
  monthStart: string;
  monthEnd: string;
  leakIls: number;
  spendIls: number;
  /** leak / spend (0..1); null when there is no spend this month. */
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  recoveredIls: number;
  invoiceCount: number;
  matchedInvoiceCount: number;
  invoicesWithLeak: number;
  /** Invoices waiting for a PO link (unmatched / consolidated / unordered) — in neither leak nor spend. */
  pendingLinkCount: number;
  pendingLinkIls: number;
  /** Receiving scans waiting for their receipt's count (#94) — in neither leak, spend nor pending link. */
  awaitingCountCount: number;
  awaitingCountIls: number;
  /** Invoices held for a "זה אותו מוצר?" question (G-08) — in neither leak, spend nor pending link. */
  awaitingQuestionCount: number;
  awaitingQuestionIls: number;
}

export interface LeakHeroOptions {
  /** Override "now" — used in tests. */
  now?: Date;
  /** 0 = this month, -1 = last month, … */
  monthOffset?: number;
}

/**
 * Shared CTEs: month bounds in the restaurant tz + the month's invoices.
 * Defines `r` (tz), `b` (lo, hi), `inv` and `per` — one row per invoice of the
 * month with: id, status, total (incl. VAT), total_excl, matched, raw_leak,
 * raw_recovered, pending_link, awaiting_count, dup_copy. The hero leak of an
 * invoice is `LEAST(raw_leak, total)`. Use as `WITH ${monthInvoicesCte(…)} …`.
 * Exported (W2-09a) for G-05/G-12/W2-03; the ₪ definition is unchanged.
 */
export function monthInvoicesCte(restaurantId: string, now: Date, offset: number) {
  return sql`
    r AS (
      SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}
    ),
    b AS (
      SELECT
        (date_trunc('month', (${now.toISOString()}::timestamptz AT TIME ZONE r.tz)) + make_interval(months => ${offset}::int)) AT TIME ZONE r.tz AS lo,
        (date_trunc('month', (${now.toISOString()}::timestamptz AT TIME ZONE r.tz)) + make_interval(months => ${offset + 1}::int)) AT TIME ZONE r.tz AS hi
      FROM r
    ),
    inv AS (
      SELECT i.id, i.status, i.total_excl_vat, i.total_incl_vat,
             ${scanAwaitingCountSql(restaurantId, sql`i`)} AS counting,
             -- G-08: held for a "זה אותו מוצר?" question (no run yet) — in neither
             -- leak, spend nor "waiting to be linked to an order".
             ${AWAITING_QUESTION_SQL} AS question
      FROM invoices i, b
      WHERE i.restaurant_id = ${restaurantId}
        AND COALESCE(i.invoice_date, i.created_at) >= b.lo
        AND COALESCE(i.invoice_date, i.created_at) < b.hi
    ),
    per AS (
      SELECT
        inv.id,
        inv.status,
        COALESCE(inv.total_incl_vat, 0) AS total,
        COALESCE(inv.total_excl_vat, 0) AS total_excl,
        bool_or(mr.id IS NOT NULL) AS matched,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0) AS raw_leak,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (
          WHERE ${LEAK_FILTER} AND d.resolution_status IN ('accepted','resolved')
        ), 0) AS raw_recovered,
        -- Pending = no PO link yet: an UNORDERED_ARRIVAL still open, or not matched
        -- at all (e.g. a parsed consolidated invoice waiting to be linked).
        (NOT bool_or(mr.id IS NOT NULL))
          OR COALESCE(bool_or(d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')), false)
          AS pending_link,
        -- …except a receiving scan held for its receipt's count (#94): bound to its
        -- order, waiting for the count. pending_link stays true (spend unchanged);
        -- the "waiting to be linked" line and list leave it out.
        (NOT bool_or(mr.id IS NOT NULL)) AND inv.counting AS awaiting_count,
        (NOT bool_or(mr.id IS NOT NULL)) AND inv.question AS awaiting_question,
        COALESCE(bool_or(${LIVE_DUPLICATE}), false) AND ${originalChecked(restaurantId, sql`inv.id`)} AS dup_copy
      FROM inv
      LEFT JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      GROUP BY inv.id, inv.status, inv.total_incl_vat, inv.total_excl_vat, inv.counting, inv.question
    )`;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
/** Round to the agora (SQL sums of NUMERIC come back exact; this only guards parsing). */
const ils = (v: unknown): number => Math.round(n(v) * 100) / 100;

export async function computeLeakHero(
  db: Database,
  restaurantId: string,
  options: LeakHeroOptions = {},
): Promise<LeakHero> {
  const now = options.now ?? new Date();
  const offset = options.monthOffset ?? 0;
  const res = await db.execute(sql`
    WITH ${monthInvoicesCte(restaurantId, now, offset)}
    SELECT
      (SELECT lo FROM b) AS lo,
      (SELECT hi FROM b) AS hi,
      COALESCE(SUM(total_excl) FILTER (WHERE NOT pending_link AND NOT dup_copy), 0) AS spend,
      (SELECT COUNT(*) FROM inv) AS invoice_count,
      COUNT(*) FILTER (WHERE matched) AS matched_count,
      COALESCE(SUM(LEAST(raw_leak, total)), 0) AS leak,
      COALESCE(SUM(LEAST(raw_leak, total)) FILTER (WHERE status <> 'paid'), 0) AS caught,
      COALESCE(SUM(LEAST(raw_recovered, LEAST(raw_leak, total))), 0) AS recovered,
      COUNT(*) FILTER (WHERE raw_leak > 0) AS with_leak,
      COUNT(*) FILTER (WHERE pending_link AND NOT awaiting_count AND NOT awaiting_question) AS pending_count,
      COALESCE(SUM(total) FILTER (WHERE pending_link AND NOT awaiting_count AND NOT awaiting_question), 0) AS pending_amount,
      COUNT(*) FILTER (WHERE awaiting_count) AS awaiting_count,
      COALESCE(SUM(total) FILTER (WHERE awaiting_count), 0) AS awaiting_amount,
      COUNT(*) FILTER (WHERE awaiting_question AND NOT awaiting_count) AS question_count,
      COALESCE(SUM(total) FILTER (WHERE awaiting_question AND NOT awaiting_count), 0) AS question_amount
    FROM per
  `);
  const r = rowsOf(res)[0] ?? {};
  const spend = ils(r.spend);
  const leak = ils(r.leak);
  return {
    monthStart: iso(r.lo),
    monthEnd: iso(r.hi),
    leakIls: leak,
    spendIls: spend,
    leakPct: spend > 0 ? leak / spend : null,
    caughtBeforePaymentIls: ils(r.caught),
    recoveredIls: ils(r.recovered),
    invoiceCount: n(r.invoice_count),
    matchedInvoiceCount: n(r.matched_count),
    invoicesWithLeak: n(r.with_leak),
    pendingLinkCount: n(r.pending_count),
    pendingLinkIls: ils(r.pending_amount),
    awaitingCountCount: n(r.awaiting_count),
    awaitingCountIls: ils(r.awaiting_amount),
    awaitingQuestionCount: n(r.question_count),
    awaitingQuestionIls: ils(r.question_amount),
  };
}

export interface LeakBreakdownLine {
  discrepancyId: string;
  type: string;
  severity: string;
  resolutionStatus: string;
  deltaAmount: number;
  expected: number | null;
  actual: number | null;
  /** Counts toward the hero leak (false for info / PRICE_LOWER / UNORDERED_ARRIVAL / a rejected duplicate). */
  countsAsLeak: boolean;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  /** Which PO line / invoice line / product the engine flagged (null when not line-level). */
  poLineId: string | null;
  /** The invoice line the finding is on; null for invoice-level findings (DUPLICATE_INVOICE, TOTAL_MISMATCH, VAT_MISMATCH…). */
  invoiceLineId: string | null;
  productId: string | null;
  // ── W2-09c evidence (additive and OPTIONAL — other packages build these objects; display only — the leak ₪ is deltaAmount, never recomputed here) ──
  /** The engine's stored tolerance string (packages/matching), e.g. "price: ±2% or ₪5". */
  toleranceUsed?: string | null;
  /** The invoice line's billed quantity, unit and unit price (null for invoice-level findings). */
  qtyBilled?: number | null;
  unit?: string | null;
  unitPriceBilled?: number | null;
  /** The PO line's agreed unit price (the 'po' basis) and unit; the engine normalizes billed qty/price to this unit. */
  unitPriceExpected?: number | null;
  poUnit?: string | null;
  /** The order behind the finding: the PO line's order, else the match run's. */
  poId?: string | null;
  /** The supplier's PO number: null until G-03 adds `purchase_orders.po_number` (display falls back to the id). */
  poNumber?: string | null;
  /** The delivery-note number (ת״מ): null here; G-03 adds the column, and packages/api parses `receiptNote` until then. */
  deliveryNoteNumber?: string | null;
  /** The goods receipt's free-text notes (where the ת.מ. number is written today). */
  receiptNote?: string | null;
  /** Where the expected value comes from. 'contract' arrives with W2-12 contract prices. */
  expectedSource?: LeakExpectedSource | null;
  /** When that basis was set: the PO's date for 'po', the receipt's for 'receipt' (ISO), else null. */
  expectedAsOf?: string | null;
}

export type LeakExpectedSource = 'po' | 'contract' | 'p90' | 'receipt' | 'invoiceTotal' | 'vat';

/** The engine's p90 tolerance prefix (packages/matching evaluateBaseline). */
const P90_PREFIX = 'actual exceeds historical p90';

/** The basis of a finding's expected value, from its type and stored tolerance (no engine import). */
export function expectedSourceOf(type: string, toleranceUsed: string | null): LeakExpectedSource | null {
  if ((toleranceUsed ?? '').startsWith(P90_PREFIX)) return 'p90';
  switch (type) {
    case 'PRICE_HIGHER':
    case 'PRICE_LOWER':
    case 'QTY_SHORT':
    case 'MISSING_ON_INVOICE':
    case 'UNORDERED_ITEM':
    case 'UNIT_MISMATCH':
      return 'po';
    case 'QTY_OVER':
      return 'receipt';
    case 'TOTAL_MISMATCH':
      return 'invoiceTotal';
    case 'VAT_MISMATCH':
      return 'vat';
    default:
      return null;
  }
}

export interface LeakBreakdownInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  status: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  /** W2-09c (optional, additive): the supplier, for the claims link of a paid invoice. */
  supplierId?: string | null;
  totalInclVat: number;
  /** This invoice's contribution to the hero leak (capped at its total). */
  leakIls: number;
  pendingLink: boolean;
  lines: LeakBreakdownLine[];
}

/**
 * The invoices (and their discrepancy lines) behind the month's hero leak,
 * biggest leak first. Invoices waiting for a PO link are included (flagged
 * `pendingLink`) after the leaking ones so the owner sees them calmly.
 */
export async function computeLeakBreakdown(
  db: Database,
  restaurantId: string,
  options: LeakHeroOptions & { limit?: number; view?: ViewSpec } = {},
): Promise<LeakBreakdownInvoice[]> {
  const now = options.now ?? new Date();
  const offset = options.monthOffset ?? 0;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  // A view (period + filters) replaces the month; without one, the hero month as before.
  const cte = options.view
    ? viewInvoicesSql(restaurantId, options.view)
    : monthInvoicesCte(restaurantId, now, offset);
  const counts = options.view ? lineFilter(restaurantId, options.view.filters) : LEAK_FILTER;

  const invRes = await db.execute(sql`
    WITH ${cte}
    SELECT
      per.id, per.status, per.total, LEAST(per.raw_leak, per.total) AS leak,
      per.pending_link AND NOT per.awaiting_count AND NOT per.awaiting_question AS pending_link,
      i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
      s.name AS supplier_name, s.name_en AS supplier_name_en, i.supplier_id
    FROM per
    JOIN invoices i ON i.id = per.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
    -- A scan waiting for its count (#94) is no leak and not "waiting to be linked".
    WHERE per.raw_leak > 0 OR (per.pending_link AND NOT per.awaiting_count AND NOT per.awaiting_question)
    ORDER BY per.pending_link ASC, LEAST(per.raw_leak, per.total) DESC, invoice_date DESC
    LIMIT ${limit}
  `);
  const invRows = rowsOf(invRes);
  if (invRows.length === 0) return [];

  const linesByInvoice = await breakdownLines(
    db,
    restaurantId,
    invRows.map((r) => String(r.id)),
    counts,
  );

  return invRows.map((r) => ({
    invoiceId: String(r.id),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiceDate: r.invoice_date == null ? null : iso(r.invoice_date),
    status: String(r.status),
    supplierName: (r.supplier_name as string | null) ?? null,
    supplierNameEn: (r.supplier_name_en as string | null) ?? null,
    supplierId: r.supplier_id == null ? null : String(r.supplier_id),
    totalInclVat: ils(r.total),
    leakIls: ils(r.leak),
    pendingLink: Boolean(r.pending_link),
    lines: linesByInvoice.get(String(r.id)) ?? [],
  }));
}

/** The discrepancy lines of the given invoices (all match runs), biggest |delta| first. */
async function breakdownLines(
  db: Database,
  restaurantId: string,
  ids: string[],
  counts: ReturnType<typeof sql>,
): Promise<Map<string, LeakBreakdownLine[]>> {
  const lineRes = await db.execute(sql`
    SELECT
      mr.invoice_id, d.id, d.type, d.severity, d.resolution_status, d.delta_amount,
      d.expected_value, d.actual_value, d.po_line_id, d.invoice_line_id, d.product_id,
      (${counts}) AS counts,
      p.canonical_name AS product_name, p.name_en AS product_name_en,
      il.raw_description AS line_desc, il.raw_description_en AS line_desc_en,
      d.tolerance_used, il.qty_billed, COALESCE(il.unit, pl.unit) AS unit, il.unit_price_billed,
      pl.unit_price_expected, pl.unit AS po_unit, po.id AS po_id, po.created_at AS po_at,
      gr.notes AS receipt_note, gr.received_at AS gr_at
    FROM discrepancies d
    JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
    LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${restaurantId}
    LEFT JOIN invoice_lines il ON il.id = d.invoice_line_id
    LEFT JOIN po_lines pl ON pl.id = d.po_line_id
    LEFT JOIN purchase_orders po ON po.id = COALESCE(pl.po_id, mr.po_id) AND po.restaurant_id = ${restaurantId}
    LEFT JOIN gr_lines grl ON grl.id = d.gr_line_id
    LEFT JOIN goods_receipts gr ON gr.id = COALESCE(grl.gr_id, mr.gr_id) AND gr.restaurant_id = ${restaurantId}
    WHERE d.restaurant_id = ${restaurantId}
      AND mr.invoice_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    ORDER BY ABS(d.delta_amount) DESC
  `);
  const linesByInvoice = new Map<string, LeakBreakdownLine[]>();
  for (const l of rowsOf(lineRes)) {
    const key = String(l.invoice_id);
    const list = linesByInvoice.get(key) ?? [];
    list.push({
      discrepancyId: String(l.id),
      type: String(l.type),
      severity: String(l.severity),
      resolutionStatus: String(l.resolution_status),
      deltaAmount: ils(l.delta_amount),
      expected: l.expected_value == null ? null : Number(l.expected_value),
      actual: l.actual_value == null ? null : Number(l.actual_value),
      countsAsLeak: Boolean(l.counts),
      productName: (l.product_name as string | null) ?? null,
      productNameEn: (l.product_name_en as string | null) ?? null,
      lineDescription: (l.line_desc as string | null) ?? null,
      lineDescriptionEn: (l.line_desc_en as string | null) ?? null,
      poLineId: (l.po_line_id as string | null) ?? null,
      invoiceLineId: l.invoice_line_id == null ? null : String(l.invoice_line_id),
      productId: (l.product_id as string | null) ?? null,
      ...evidenceOf(l),
    });
    linesByInvoice.set(key, list);
  }
  return linesByInvoice;
}

/**
 * The per-invoice leak state of the given invoices, whatever their dates —
 * the same filter, cap and pending-link rule as the month breakdown (this is
 * the CTE behind `computeInvoiceLeak` / `computeInvoicesLeak`). Defines `per`
 * with one row per invoice of this restaurant among `invoiceIds`:
 *   id, status, total (incl. VAT), total_excl, matched, raw_leak,
 *   leak = LEAST(raw_leak, total), raw_recovered, recovered (same cap),
 *   pending_link.
 * Use as `WITH ${invoiceLeakStateCte(rid, ids)} SELECT … FROM per`.
 * `invoiceIds` must be non-empty. A foreign invoice id yields no row.
 */
export function invoiceLeakStateCte(restaurantId: string, invoiceIds: readonly string[]) {
  if (invoiceIds.length === 0) throw new Error('invoiceLeakStateCte: invoiceIds is empty');
  return sql`
    per AS (
      SELECT
        i.id,
        i.status,
        COALESCE(i.total_incl_vat, 0) AS total,
        COALESCE(i.total_excl_vat, 0) AS total_excl,
        COALESCE(bool_or(mr.id IS NOT NULL), false) AS matched,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0) AS raw_leak,
        LEAST(COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0), COALESCE(i.total_incl_vat, 0)) AS leak,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (
          WHERE ${LEAK_FILTER} AND d.resolution_status IN ('accepted','resolved')
        ), 0) AS raw_recovered,
        LEAST(
          COALESCE(SUM(ABS(d.delta_amount)) FILTER (
            WHERE ${LEAK_FILTER} AND d.resolution_status IN ('accepted','resolved')
          ), 0),
          LEAST(COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0), COALESCE(i.total_incl_vat, 0))
        ) AS recovered,
        (NOT bool_or(mr.id IS NOT NULL))
          OR COALESCE(bool_or(d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')), false)
          AS pending_link
      FROM invoices i
      LEFT JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
      LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      WHERE i.restaurant_id = ${restaurantId}
        AND i.id IN (${sql.join(invoiceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      GROUP BY i.id, i.status, i.total_incl_vat, i.total_excl_vat
    )`;
}

/** Ids per batch query (keeps the IN list and the line fetch bounded). */
const INVOICE_BATCH = 500;

/**
 * Many invoices' leaks in one pass (W2-09a): each value is exactly what
 * `computeInvoiceLeak` returns for that id. Keyed by invoice id, in the input
 * order; ids that are not this restaurant's (or do not exist) are absent.
 * Duplicate ids are fetched once.
 */
export async function computeInvoicesLeak(
  db: Database,
  restaurantId: string,
  invoiceIds: readonly string[],
): Promise<Map<string, LeakBreakdownInvoice>> {
  const ids = [...new Set(invoiceIds)];
  const found = new Map<string, LeakBreakdownInvoice>();
  for (let at = 0; at < ids.length; at += INVOICE_BATCH) {
    const chunk = ids.slice(at, at + INVOICE_BATCH);
    const res = await db.execute(sql`
      WITH ${invoiceLeakStateCte(restaurantId, chunk)}
      SELECT
        per.id, per.status, per.total, per.leak, per.pending_link,
        i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
        s.name AS supplier_name, s.name_en AS supplier_name_en, i.supplier_id
      FROM per
      JOIN invoices i ON i.id = per.id
      LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
    `);
    const rows = rowsOf(res);
    if (rows.length === 0) continue;
    const lines = await breakdownLines(db, restaurantId, rows.map((r) => String(r.id)), LEAK_FILTER);
    for (const r of rows) found.set(String(r.id), invoiceOf(r, lines));
  }
  const out = new Map<string, LeakBreakdownInvoice>();
  for (const id of ids) {
    const v = found.get(id);
    if (v) out.set(id, v);
  }
  return out;
}

function invoiceOf(r: Row, lines: Map<string, LeakBreakdownLine[]>): LeakBreakdownInvoice {
  return {
    invoiceId: String(r.id),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiceDate: r.invoice_date == null ? null : iso(r.invoice_date),
    status: String(r.status),
    supplierName: (r.supplier_name as string | null) ?? null,
    supplierNameEn: (r.supplier_name_en as string | null) ?? null,
    supplierId: r.supplier_id == null ? null : String(r.supplier_id),
    totalInclVat: ils(r.total),
    leakIls: ils(r.leak),
    pendingLink: Boolean(r.pending_link),
    lines: lines.get(String(r.id)) ?? [],
  };
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** The W2-09c evidence fields of one breakdown row (raw facts; packages/api verifies the math). */
function evidenceOf(l: Row) {
  const type = String(l.type);
  const toleranceUsed = (l.tolerance_used as string | null) ?? null;
  const expectedSource = expectedSourceOf(type, toleranceUsed);
  const asOf = expectedSource === 'po' ? l.po_at : expectedSource === 'receipt' ? l.gr_at : null;
  return {
    toleranceUsed,
    qtyBilled: numOrNull(l.qty_billed),
    unit: (l.unit as string | null) ?? null,
    unitPriceBilled: numOrNull(l.unit_price_billed),
    unitPriceExpected: numOrNull(l.unit_price_expected),
    poUnit: (l.po_unit as string | null) ?? null,
    poId: l.po_id == null ? null : String(l.po_id),
    poNumber: null,
    deliveryNoteNumber: null,
    receiptNote: (l.receipt_note as string | null) ?? null,
    expectedSource,
    expectedAsOf: asOf == null ? null : iso(asOf),
  };
}

/**
 * One invoice's leak exactly as the month breakdown computes it (same filter,
 * same cap at the invoice total, same pending-link rule) — whatever its date.
 * Null when the invoice is not this restaurant's.
 */
export async function computeInvoiceLeak(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<LeakBreakdownInvoice | null> {
  return (await computeInvoicesLeak(db, restaurantId, [invoiceId])).get(invoiceId) ?? null;
}
