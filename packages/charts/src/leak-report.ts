import { sql, type Database } from '@restomatch/db';
import { computeLeakHero, type LeakHero } from './leak-hero';
import { LEAK_FILTER, LIVE_DUPLICATE, originalChecked } from './leak-views';

/**
 * The monthly leak report — the one-page, print-ready story an owner can hand
 * to a partner or accountant: the hero ₪ + % of spend, where it came from (by
 * discrepancy type and by supplier), which prices crept up, and what happened
 * to it (caught before payment, still open, claimed back, waived).
 *
 * Same rules as the hero (see leak-hero.ts): warn/block only, no PRICE_LOWER,
 * no UNORDERED_ARRIVAL, per-invoice cap at the invoice total, month = the
 * restaurant's local calendar month by invoice date, spend = checked invoices.
 * The per-supplier rows are capped exactly like the hero, so they sum to it.
 * The per-type and per-status rows are line sums BEFORE the per-invoice cap
 * (`capAdjustmentIls` is the difference, almost always 0).
 */

export interface LeakReportTypeRow {
  type: string;
  count: number;
  amountIls: number;
}

export interface LeakReportSupplierRow {
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  invoiceCount: number;
  spendIls: number;
  leakIls: number;
  /** leak / spend for this supplier; null without checked spend. */
  leakPct: number | null;
}

export interface LeakReportPriceCreepRow {
  productId: string;
  productName: string;
  productNameEn: string | null;
  supplierName: string;
  supplierNameEn: string | null;
  /** Median unit price over the 90 days before the month. */
  beforePrice: number;
  /** Average unit price observed during the month. */
  afterPrice: number;
  deltaPct: number;
  /** (after − before) × quantity bought during the month. */
  excessIls: number;
  qty: number;
}

export interface LeakReportStatus {
  /** Leak on invoices not yet paid. */
  caughtBeforePaymentIls: number;
  /** Discrepancy lines still waiting for a decision (open / escalated). */
  stillOpenIls: number;
  stillOpenCount: number;
  /** Lines approved to claim back from the supplier (credit requested). */
  claimedIls: number;
  claimedCount: number;
  /** Lines the team decided to let go. */
  waivedIls: number;
  waivedCount: number;
  /** Suppliers with at least one claimed line (one credit request each). */
  creditRequestSuppliers: number;
}

export interface LeakReport {
  /** 'YYYY-MM' of the reported month. */
  month: string;
  hero: LeakHero;
  byType: LeakReportTypeRow[];
  bySupplier: LeakReportSupplierRow[];
  priceCreep: LeakReportPriceCreepRow[];
  status: LeakReportStatus;
  /** Σ type rows − hero leak (≥ 0): the amount removed by the per-invoice cap. */
  capAdjustmentIls: number;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const ils = (v: unknown): number => Math.round(n(v) * 100) / 100;
const str = (v: unknown): string | null => (v == null ? null : String(v));

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Parse 'YYYY-MM'; throws on anything else (callers validate first). */
export function parseReportMonth(month: string): { year: number; month: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`invalid month "${month}" (expected YYYY-MM)`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export async function computeLeakReport(
  db: Database,
  restaurantId: string,
  month: string,
  options: { priceCreepLimit?: number } = {},
): Promise<LeakReport> {
  const { year, month: mm } = parseReportMonth(month);
  // Mid-month noon UTC is inside the same local month in every real timezone,
  // so the hero's tz-aware month bounds resolve to exactly this month.
  const anchor = new Date(Date.UTC(year, mm - 1, 15, 12, 0, 0));
  const hero = await computeLeakHero(db, restaurantId, { now: anchor });
  const lo = hero.monthStart;
  const hi = hero.monthEnd;
  const creepLimit = Math.min(Math.max(options.priceCreepLimit ?? 8, 1), 50);

  // Invoices of the month that count (checked: matched, not pending a PO link).
  const monthInv = sql`
    inv AS (
      SELECT i.id, i.supplier_id, i.status, COALESCE(i.total_incl_vat, 0) AS total,
             COALESCE(i.total_excl_vat, 0) AS total_excl
      FROM invoices i
      WHERE i.restaurant_id = ${restaurantId}
        AND COALESCE(i.invoice_date, i.created_at) >= ${lo}::timestamptz
        AND COALESCE(i.invoice_date, i.created_at) < ${hi}::timestamptz
    ),
    lines AS (
      SELECT inv.id AS invoice_id, inv.supplier_id, inv.status, d.type, d.resolution_status,
             ABS(d.delta_amount) AS amt,
             (${LEAK_FILTER} AND ABS(d.delta_amount) > 0) AS counts
      FROM inv
      JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
    ),
    per AS (
      SELECT inv.id, inv.supplier_id, inv.status, inv.total, inv.total_excl,
        EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}) AS matched,
        COALESCE((SELECT SUM(l.amt) FROM lines l WHERE l.invoice_id = inv.id AND l.counts), 0) AS raw_leak,
        EXISTS (SELECT 1 FROM lines l WHERE l.invoice_id = inv.id AND l.type = 'UNORDERED_ARRIVAL'
                AND l.resolution_status IN ('open','escalated')) AS no_po,
        EXISTS (SELECT 1 FROM match_runs mr JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
                WHERE mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId} AND ${LIVE_DUPLICATE})
          AND ${originalChecked(restaurantId, sql`inv.id`)} AS dup_copy
      FROM inv
    )`;

  const [typeRes, supplierRes, statusRes] = await Promise.all([
    db.execute(sql`
      WITH ${monthInv}
      SELECT type, COUNT(*) AS c, COALESCE(SUM(amt), 0) AS amount
      FROM lines WHERE counts
      GROUP BY type ORDER BY SUM(amt) DESC
    `),
    db.execute(sql`
      WITH ${monthInv}
      SELECT per.supplier_id, s.name, s.name_en,
        COUNT(*) FILTER (WHERE per.matched AND NOT per.no_po) AS invoice_count,
        COALESCE(SUM(per.total_excl) FILTER (WHERE per.matched AND NOT per.no_po AND NOT per.dup_copy), 0) AS spend,
        COALESCE(SUM(LEAST(per.raw_leak, per.total)), 0) AS leak
      FROM per
      LEFT JOIN suppliers s ON s.id = per.supplier_id AND s.restaurant_id = ${restaurantId}
      GROUP BY per.supplier_id, s.name, s.name_en
      HAVING COUNT(*) FILTER (WHERE per.matched AND NOT per.no_po) > 0
      ORDER BY COALESCE(SUM(LEAST(per.raw_leak, per.total)), 0) DESC, s.name
    `),
    db.execute(sql`
      WITH ${monthInv}
      SELECT
        COALESCE(SUM(amt) FILTER (WHERE resolution_status IN ('open','escalated')), 0) AS open_amt,
        COUNT(*) FILTER (WHERE resolution_status IN ('open','escalated')) AS open_c,
        COALESCE(SUM(amt) FILTER (WHERE resolution_status IN ('accepted','resolved')), 0) AS claimed_amt,
        COUNT(*) FILTER (WHERE resolution_status IN ('accepted','resolved')) AS claimed_c,
        COALESCE(SUM(amt) FILTER (WHERE resolution_status = 'rejected'), 0) AS waived_amt,
        COUNT(*) FILTER (WHERE resolution_status = 'rejected') AS waived_c,
        COUNT(DISTINCT supplier_id) FILTER (WHERE resolution_status IN ('accepted','resolved')) AS credit_suppliers
      FROM lines WHERE counts
    `),
  ]);

  // Price creep: month average vs the median of the 90 days before the month,
  // per (product, supplier), from price_history (fed by every match — M1).
  const creepRes = await db.execute(sql`
    WITH before AS (
      SELECT product_id, supplier_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unit_price) AS p50
      FROM price_history
      WHERE restaurant_id = ${restaurantId}
        AND observed_at >= ${lo}::timestamptz - interval '90 days'
        AND observed_at < ${lo}::timestamptz
      GROUP BY product_id, supplier_id
    ),
    during AS (
      SELECT product_id, supplier_id, AVG(unit_price) AS avg_price, COALESCE(SUM(qty), 0) AS qty
      FROM price_history
      WHERE restaurant_id = ${restaurantId}
        AND observed_at >= ${lo}::timestamptz
        AND observed_at < ${hi}::timestamptz
      GROUP BY product_id, supplier_id
    )
    SELECT d.product_id, p.canonical_name, p.name_en, s.name AS supplier_name, s.name_en AS supplier_name_en,
      b.p50 AS before_price, d.avg_price AS after_price, d.qty,
      (d.avg_price - b.p50) / b.p50 AS delta_pct,
      (d.avg_price - b.p50) * d.qty AS excess
    FROM during d
    JOIN before b ON b.product_id = d.product_id AND b.supplier_id = d.supplier_id
    JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${restaurantId}
    JOIN suppliers s ON s.id = d.supplier_id AND s.restaurant_id = ${restaurantId}
    WHERE b.p50 > 0 AND d.avg_price > b.p50 * 1.02
    ORDER BY (d.avg_price - b.p50) * GREATEST(d.qty, 1) DESC
    LIMIT ${creepLimit}
  `);

  const byType = rowsOf(typeRes).map((r) => ({
    type: String(r.type),
    count: n(r.c),
    amountIls: ils(r.amount),
  }));
  const bySupplier = rowsOf(supplierRes).map((r) => {
    const spend = ils(r.spend);
    const leak = ils(r.leak);
    return {
      supplierId: str(r.supplier_id),
      supplierName: str(r.name),
      supplierNameEn: str(r.name_en),
      invoiceCount: n(r.invoice_count),
      spendIls: spend,
      leakIls: leak,
      leakPct: spend > 0 ? leak / spend : null,
    };
  });
  const priceCreep = rowsOf(creepRes).map((r) => ({
    productId: String(r.product_id),
    productName: String(r.canonical_name),
    productNameEn: str(r.name_en),
    supplierName: String(r.supplier_name),
    supplierNameEn: str(r.supplier_name_en),
    beforePrice: Math.round(n(r.before_price) * 10000) / 10000,
    afterPrice: Math.round(n(r.after_price) * 10000) / 10000,
    deltaPct: n(r.delta_pct),
    excessIls: ils(r.excess),
    qty: n(r.qty),
  }));
  const s = rowsOf(statusRes)[0] ?? {};
  const typeSum = byType.reduce((acc, t) => acc + Math.round(t.amountIls * 100), 0) / 100;

  return {
    month,
    hero,
    byType,
    bySupplier,
    priceCreep,
    status: {
      caughtBeforePaymentIls: hero.caughtBeforePaymentIls,
      stillOpenIls: ils(s.open_amt),
      stillOpenCount: n(s.open_c),
      claimedIls: ils(s.claimed_amt),
      claimedCount: n(s.claimed_c),
      waivedIls: ils(s.waived_amt),
      waivedCount: n(s.waived_c),
      creditRequestSuppliers: n(s.credit_suppliers),
    },
    capAdjustmentIls: Math.max(0, Math.round((typeSum - hero.leakIls) * 100) / 100),
  };
}
