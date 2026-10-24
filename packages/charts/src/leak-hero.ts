import { sql, type Database } from '@restomatch/db';
import { lineFilter, viewInvoicesSql, type ViewSpec } from './leak-views';

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
 *    calmly as "waiting for a PO link", never as a false alarm).
 *  • Per invoice the leak is capped at the invoice total: you cannot lose more
 *    on an invoice than the invoice itself (stacked DUPLICATE + line findings).
 *  • Spend = Σ total_excl_vat of the month's CHECKED invoices (matched to a PO),
 *    so "% of spend" is leak ÷ the spend it was measured on. Invoices not yet
 *    linked to a PO (unmatched / consolidated) are "pending": in neither.
 *  • Caught before payment = leak on invoices not yet marked paid.
 *  • Recovered = the part of the leak the team accepted as a claim
 *    (resolution accepted/resolved) — same cap.
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
}

export interface LeakHeroOptions {
  /** Override "now" — used in tests. */
  now?: Date;
  /** 0 = this month, -1 = last month, … */
  monthOffset?: number;
}

const LEAK_FILTER = sql`d.severity IN ('warn','block') AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL')`;

/** Shared CTEs: month bounds in the restaurant tz + the month's invoices. */
function monthInvoicesCte(restaurantId: string, now: Date, offset: number) {
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
      SELECT i.id, i.status, i.total_excl_vat, i.total_incl_vat
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
          AS pending_link
      FROM inv
      LEFT JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      GROUP BY inv.id, inv.status, inv.total_incl_vat, inv.total_excl_vat
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
      COALESCE(SUM(total_excl) FILTER (WHERE NOT pending_link), 0) AS spend,
      (SELECT COUNT(*) FROM inv) AS invoice_count,
      COUNT(*) FILTER (WHERE matched) AS matched_count,
      COALESCE(SUM(LEAST(raw_leak, total)), 0) AS leak,
      COALESCE(SUM(LEAST(raw_leak, total)) FILTER (WHERE status <> 'paid'), 0) AS caught,
      COALESCE(SUM(LEAST(raw_recovered, LEAST(raw_leak, total))), 0) AS recovered,
      COUNT(*) FILTER (WHERE raw_leak > 0) AS with_leak,
      COUNT(*) FILTER (WHERE pending_link) AS pending_count,
      COALESCE(SUM(total) FILTER (WHERE pending_link), 0) AS pending_amount
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
  /** Counts toward the hero leak (false for info / PRICE_LOWER / UNORDERED_ARRIVAL). */
  countsAsLeak: boolean;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  /** Which PO line / invoice line / product the engine flagged (null when not line-level). */
  poLineId: string | null;
  invoiceLineId: string | null;
  productId: string | null;
}

export interface LeakBreakdownInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  status: string;
  supplierName: string | null;
  supplierNameEn: string | null;
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
      per.id, per.status, per.total, LEAST(per.raw_leak, per.total) AS leak, per.pending_link,
      i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
      s.name AS supplier_name, s.name_en AS supplier_name_en
    FROM per
    JOIN invoices i ON i.id = per.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
    WHERE per.raw_leak > 0 OR per.pending_link
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
      il.raw_description AS line_desc, il.raw_description_en AS line_desc_en
    FROM discrepancies d
    JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
    LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${restaurantId}
    LEFT JOIN invoice_lines il ON il.id = d.invoice_line_id
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
      invoiceLineId: (l.invoice_line_id as string | null) ?? null,
      productId: (l.product_id as string | null) ?? null,
    });
    linesByInvoice.set(key, list);
  }
  return linesByInvoice;
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
  const res = await db.execute(sql`
    WITH per AS (
      SELECT
        i.id,
        i.status,
        COALESCE(i.total_incl_vat, 0) AS total,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LEAK_FILTER}), 0) AS raw_leak,
        (NOT bool_or(mr.id IS NOT NULL))
          OR COALESCE(bool_or(d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')), false)
          AS pending_link
      FROM invoices i
      LEFT JOIN match_runs mr ON mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId}
      LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      WHERE i.id = ${invoiceId}::uuid AND i.restaurant_id = ${restaurantId}
      GROUP BY i.id, i.status, i.total_incl_vat
    )
    SELECT
      per.id, per.status, per.total, LEAST(per.raw_leak, per.total) AS leak, per.pending_link,
      i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS invoice_date,
      s.name AS supplier_name, s.name_en AS supplier_name_en
    FROM per
    JOIN invoices i ON i.id = per.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
  `);
  const [r] = rowsOf(res);
  if (!r) return null;
  const lines = await breakdownLines(db, restaurantId, [String(r.id)], LEAK_FILTER);
  return {
    invoiceId: String(r.id),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    invoiceDate: r.invoice_date == null ? null : iso(r.invoice_date),
    status: String(r.status),
    supplierName: (r.supplier_name as string | null) ?? null,
    supplierNameEn: (r.supplier_name_en as string | null) ?? null,
    totalInclVat: ils(r.total),
    leakIls: ils(r.leak),
    pendingLink: Boolean(r.pending_link),
    lines: lines.get(String(r.id)) ?? [],
  };
}

/** Resolution statuses that can still be claimed from the supplier. */
export const CLAIMABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'escalated', 'accepted']);

/**
 * The supplier-claim amounts of one breakdown invoice — the single source for
 * the claims letters and the dock dispute slip, so both agree to the agora:
 * lines that count as leak and are still claimable, each |delta| but never more
 * in total than the invoice's capped leak. Nothing is claimable on an invoice
 * waiting for a PO link or already paid.
 */
export function claimableLines(inv: LeakBreakdownInvoice): Array<{ line: LeakBreakdownLine; amount: number }> {
  if (inv.pendingLink || inv.status === 'paid') return [];
  const out: Array<{ line: LeakBreakdownLine; amount: number }> = [];
  let claimed = 0;
  for (const line of inv.lines) {
    if (!line.countsAsLeak || !CLAIMABLE_STATUSES.has(line.resolutionStatus)) continue;
    const amount = Math.round(Math.min(Math.abs(line.deltaAmount), Math.max(0, inv.leakIls - claimed)) * 100) / 100;
    if (amount <= 0) continue;
    claimed = Math.round((claimed + amount) * 100) / 100;
    out.push({ line, amount });
  }
  return out;
}
