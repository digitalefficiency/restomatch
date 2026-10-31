import { sql, type Database } from '@restomatch/db';
import { scanAwaitingCountSql } from './awaiting-count';
import type { LeakHero } from './leak-hero';

type SQL = ReturnType<typeof sql>;

/**
 * View-driven leak analytics: the hero rules (see leak-hero.ts) generalized to
 * any period, an optional comparison period, filters and a group-by.
 *
 * Same definitions as the hero, so the default view (this month, no filters)
 * returns the hero's numbers exactly (tested):
 *  • leak = Σ|delta| of the lines LEAK_FILTER counts (warn/block, excluding
 *    PRICE_LOWER, UNORDERED_ARRIVAL and rejected duplicates), capped per
 *    invoice at the invoice total;
 *  • spend = Σ total_excl_vat of CHECKED invoices (matched, not pending a PO
 *    link, not a live duplicate copy);
 *  • periods are local calendar ranges in the restaurant's timezone, by invoice date.
 *
 * Filters: `supplierIds` narrows the invoices (leak AND spend). `categories`,
 * `types`, `severities` and `statuses` narrow which discrepancy lines count as
 * leak (spend is unaffected). Every value is bound as a SQL parameter; the
 * period and group-by only ever select one of the fixed fragments below.
 */

export const VIEW_PERIODS = ['this_month', 'last_month', 'quarter', 'ytd', 'last_12m', 'custom'] as const;
export type ViewPeriod = (typeof VIEW_PERIODS)[number];
export const VIEW_COMPARES = ['off', 'prev', 'yoy'] as const;
export type ViewCompare = (typeof VIEW_COMPARES)[number];
export const VIEW_GROUPS = ['supplier', 'category', 'product', 'type'] as const;
export type ViewGroup = (typeof VIEW_GROUPS)[number];
export const LEAK_SEVERITIES = ['warn', 'block'] as const;
export const RESOLUTION_STATUSES = ['open', 'escalated', 'accepted', 'rejected', 'resolved'] as const;

export interface ViewFilters {
  supplierIds?: string[];
  categories?: string[];
  types?: string[];
  severities?: Array<(typeof LEAK_SEVERITIES)[number]>;
  statuses?: Array<(typeof RESOLUTION_STATUSES)[number]>;
}

export interface ViewSpec {
  period: ViewPeriod;
  /** 'YYYY-MM-DD' local dates, inclusive; required for `custom`. */
  from?: string;
  to?: string;
  filters?: ViewFilters;
  /** Override "now" — tests. */
  now?: Date;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const ils = (v: unknown): number => Math.round(n(v) * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day in 2000–2100 (Postgres throws on 2026-02-30 / 0000-01-01). */
const realDate = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const d = new Date(`${s}T00:00:00Z`);
  return y >= 2000 && y <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Local [lo, hi) for a period, as expressions over `nl` (now, local wall clock). */
function periodBounds(spec: ViewSpec): { lo: SQL; hi: SQL; step: SQL | null } {
  switch (spec.period) {
    case 'this_month':
      return { lo: sql`date_trunc('month', nl)`, hi: sql`date_trunc('month', nl) + interval '1 month'`, step: sql`interval '1 month'` };
    case 'last_month':
      return { lo: sql`date_trunc('month', nl) - interval '1 month'`, hi: sql`date_trunc('month', nl)`, step: sql`interval '1 month'` };
    case 'quarter':
      return { lo: sql`date_trunc('quarter', nl)`, hi: sql`date_trunc('quarter', nl) + interval '3 months'`, step: sql`interval '3 months'` };
    case 'ytd':
      return { lo: sql`date_trunc('year', nl)`, hi: sql`date_trunc('day', nl) + interval '1 day'`, step: null };
    case 'last_12m':
      return {
        lo: sql`date_trunc('month', nl) - interval '11 months'`,
        hi: sql`date_trunc('month', nl) + interval '1 month'`,
        step: sql`interval '12 months'`,
      };
    case 'custom': {
      if (!spec.from || !spec.to || !realDate(spec.from) || !realDate(spec.to)) {
        throw new Error('custom period needs from/to as YYYY-MM-DD');
      }
      const [a, b] = spec.from <= spec.to ? [spec.from, spec.to] : [spec.to, spec.from];
      return { lo: sql`${a}::date::timestamp`, hi: sql`${b}::date::timestamp + interval '1 day'`, step: null };
    }
  }
}

/** CTE `b(lo, hi)` (UTC instants) for the spec, optionally shifted to its comparison period. */
function boundsCte(restaurantId: string, spec: ViewSpec, compare: ViewCompare): SQL {
  const now = (spec.now ?? new Date()).toISOString();
  const { lo, hi, step } = periodBounds(spec);
  // Previous period: the calendar step for calendar periods, else the same length right before.
  // A comparison covers the same to-date stretch: a period still running (this month,
  // quarter, 12 months, a range ending in the future) is cut at the end of today before
  // shifting, so 3 days of October compare with Sep 1–3, not all of September.
  const shiftedHi = compare === 'off' ? sql`b0.hi_l` : sql`LEAST(b0.hi_l, date_trunc('day', b0.nl) + interval '1 day')`;
  const shift =
    compare === 'yoy'
      ? sql`interval '1 year'`
      : compare === 'prev'
        ? (step ?? sql`(b0.hi_l - b0.lo_l)`)
        : sql`interval '0'`;
  return sql`
    r AS (
      SELECT COALESCE(timezone, 'Asia/Jerusalem') AS tz FROM restaurants WHERE id = ${restaurantId}
    ),
    nn AS (SELECT (${now}::timestamptz AT TIME ZONE r.tz) AS nl, r.tz FROM r),
    b0 AS (SELECT ${lo} AS lo_l, ${hi} AS hi_l, nl, tz FROM nn),
    b AS (
      SELECT (b0.lo_l - ${shift}) AT TIME ZONE b0.tz AS lo,
             (${shiftedHi} - ${shift}) AT TIME ZONE b0.tz AS hi,
             b0.tz
      FROM b0
    )`;
}

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const textList = (vals: string[]) => sql.join(vals.map((v) => sql`${v}`), sql`, `);

/**
 * Does a discrepancy line (alias `d`) count toward the leak? warn/block only;
 * never PRICE_LOWER (an under-charge) or UNORDERED_ARRIVAL (waiting for a PO
 * link); and never a DUPLICATE_INVOICE a bookkeeper rejected — "not a
 * duplicate" means no money was at risk. (Other rejected findings stay in: the
 * money did leak, the team chose not to claim it — the report's "waived".)
 * The single definition for the hero, views, report and chain.
 */
export const LEAK_FILTER: SQL = sql`d.severity IN ('warn','block')
  AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL')
  AND NOT (d.type = 'DUPLICATE_INVOICE' AND d.resolution_status = 'rejected')`;

/**
 * A live duplicate finding (alias `d`): the invoice is a second bill for goods
 * another invoice already billed. Its whole value is the leak, but it is not
 * food spend when the original already carries that spend (originalChecked) —
 * then it stays out of the "% of spend" denominator. Once rejected ("not a
 * duplicate") the invoice is ordinary spend again.
 */
export const LIVE_DUPLICATE: SQL = sql`d.type = 'DUPLICATE_INVOICE' AND d.severity IN ('warn','block')
  AND d.resolution_status <> 'rejected'`;

/** normalizeInvoiceNumber (packages/api match/buildMatchInput.ts) in SQL: letters/digits, upper-case, no leading zeros. */
const normNumber = (col: SQL) =>
  sql`NULLIF(regexp_replace(regexp_replace(upper(normalize(${col}, NFKC)), '[^[:alnum:]]', '', 'g'), '(^|[^0-9])0+([0-9])', '\\1\\2', 'g'), '')`;

/**
 * Is the ORIGINAL of duplicate copy `invoiceId` itself in checked spend? The
 * original is found the way the engine found it (buildMatchInput): the held
 * copy's ocr_payload.raw.duplicateOf invoice, or an earlier invoice of the same
 * supplier with the same normalized number. Checked = matched to a PO and not
 * waiting for a PO link. Only then is the copy's spend already counted — if the
 * original is pending / unmatched, dropping the copy too would leave the goods
 * in neither (₪39,900 instead of ₪42,263, 8.6% instead of 1.8%).
 */
export function originalChecked(restaurantId: string, invoiceId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM invoices c
    JOIN invoices o ON o.restaurant_id = c.restaurant_id AND o.id <> c.id
    WHERE c.id = ${invoiceId}
      AND c.restaurant_id = ${restaurantId}
      AND (
        o.id::text = c.ocr_payload -> 'raw' -> 'duplicateOf' ->> 'invoiceId'
        OR (
          o.supplier_id = c.supplier_id
          AND ${normNumber(sql`o.invoice_number`)} = ${normNumber(sql`c.invoice_number`)}
          AND (o.created_at < c.created_at OR (o.created_at = c.created_at AND o.id < c.id))
        )
      )
      AND EXISTS (SELECT 1 FROM match_runs omr WHERE omr.invoice_id = o.id AND omr.restaurant_id = ${restaurantId})
      AND NOT EXISTS (
        SELECT 1 FROM match_runs omr
        JOIN discrepancies od ON od.match_run_id = omr.id AND od.restaurant_id = ${restaurantId}
        WHERE omr.invoice_id = o.id AND omr.restaurant_id = ${restaurantId}
          AND od.type = 'UNORDERED_ARRIVAL' AND od.resolution_status IN ('open','escalated')
      )
  )`;
}

/** Extra discrepancy-line conditions from the filters (on alias `d`). */
export function lineFilter(restaurantId: string, f: ViewFilters | undefined): SQL {
  const parts: SQL[] = [LEAK_FILTER];
  if (f?.types?.length) parts.push(sql`d.type::text IN (${textList(f.types)})`);
  if (f?.severities?.length) parts.push(sql`d.severity::text IN (${textList(f.severities)})`);
  if (f?.statuses?.length) parts.push(sql`d.resolution_status::text IN (${textList(f.statuses)})`);
  if (f?.categories?.length) {
    parts.push(sql`d.product_id IN (
      SELECT p.id FROM products p WHERE p.restaurant_id = ${restaurantId} AND p.category IN (${textList(f.categories)})
    )`);
  }
  return sql.join(parts, sql` AND `);
}

/** `inv` (period's invoices, supplier-filtered), `per` (per-invoice leak/spend) on top of `b`. */
function invoicesCte(restaurantId: string, f: ViewFilters | undefined): SQL {
  const LF = lineFilter(restaurantId, f);
  const supplierCond = f?.supplierIds?.length ? sql`AND i.supplier_id IN (${uuidList(f.supplierIds)})` : sql``;
  return sql`
    inv AS (
      SELECT i.id, i.supplier_id, i.status, i.total_excl_vat, i.total_incl_vat,
             COALESCE(i.invoice_date, i.created_at) AS at,
             ${scanAwaitingCountSql(restaurantId, sql`i`)} AS counting
      FROM invoices i, b
      WHERE i.restaurant_id = ${restaurantId}
        AND COALESCE(i.invoice_date, i.created_at) >= b.lo
        AND COALESCE(i.invoice_date, i.created_at) < b.hi
        ${supplierCond}
    ),
    per AS (
      SELECT
        inv.id, inv.supplier_id, inv.status, inv.at,
        COALESCE(inv.total_incl_vat, 0) AS total,
        COALESCE(inv.total_excl_vat, 0) AS total_excl,
        bool_or(mr.id IS NOT NULL) AS matched,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (WHERE ${LF}), 0) AS raw_leak,
        COALESCE(SUM(ABS(d.delta_amount)) FILTER (
          WHERE ${LF} AND d.resolution_status IN ('accepted','resolved')
        ), 0) AS raw_recovered,
        (NOT bool_or(mr.id IS NOT NULL))
          OR COALESCE(bool_or(d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')), false)
          AS pending_link,
        -- A receiving scan held for its count (#94) — same rule as the hero (leak-hero.ts).
        (NOT bool_or(mr.id IS NOT NULL)) AND inv.counting AS awaiting_count,
        COALESCE(bool_or(${LIVE_DUPLICATE}), false) AND ${originalChecked(restaurantId, sql`inv.id`)} AS dup_copy
      FROM inv
      LEFT JOIN match_runs mr ON mr.invoice_id = inv.id AND mr.restaurant_id = ${restaurantId}
      LEFT JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      GROUP BY inv.id, inv.supplier_id, inv.status, inv.at, inv.total_incl_vat, inv.total_excl_vat, inv.counting
    )`;
}

/** Hero-shaped summary for any period (+ filters). `monthStart/monthEnd` = the range bounds. */
export async function computeLeakSummary(
  db: Database,
  restaurantId: string,
  spec: ViewSpec,
  compare: ViewCompare = 'off',
): Promise<LeakHero> {
  const res = await db.execute(sql`
    WITH ${boundsCte(restaurantId, spec, compare)}, ${invoicesCte(restaurantId, spec.filters)}
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
      COUNT(*) FILTER (WHERE pending_link AND NOT awaiting_count) AS pending_count,
      COALESCE(SUM(total) FILTER (WHERE pending_link AND NOT awaiting_count), 0) AS pending_amount,
      COUNT(*) FILTER (WHERE awaiting_count) AS awaiting_count,
      COALESCE(SUM(total) FILTER (WHERE awaiting_count), 0) AS awaiting_amount
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
  };
}

export interface LeakGroupRow {
  /** Stable key: supplier/product id, category text, or discrepancy type. '' = none. */
  key: string;
  label: string | null;
  labelEn: string | null;
  leakIls: number;
  /** Discrepancy lines counted. */
  count: number;
}

const GROUP_SQL: Record<ViewGroup, { key: SQL; label: SQL; labelEn: SQL; join: (rid: string) => SQL }> = {
  supplier: {
    key: sql`COALESCE(per.supplier_id::text, '')`,
    label: sql`s.name`,
    labelEn: sql`s.name_en`,
    join: (rid) => sql`LEFT JOIN suppliers s ON s.id = per.supplier_id AND s.restaurant_id = ${rid}`,
  },
  category: {
    key: sql`COALESCE(p.category, '')`,
    label: sql`p.category`,
    labelEn: sql`NULL::text`,
    join: (rid) => sql`LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${rid}`,
  },
  product: {
    key: sql`COALESCE(d.product_id::text, '')`,
    label: sql`p.canonical_name`,
    labelEn: sql`p.name_en`,
    join: (rid) => sql`LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${rid}`,
  },
  type: {
    key: sql`d.type::text`,
    label: sql`d.type::text`,
    labelEn: sql`NULL::text`,
    join: () => sql``,
  },
};

/**
 * Leak grouped by supplier / category / product / discrepancy type: line sums
 * before the per-invoice cap (like the report's by-type table), biggest first.
 */
export async function computeLeakGrouped(
  db: Database,
  restaurantId: string,
  spec: ViewSpec,
  groupBy: ViewGroup,
  compare: ViewCompare = 'off',
  limit = 50,
): Promise<LeakGroupRow[]> {
  const g = GROUP_SQL[groupBy];
  const LF = lineFilter(restaurantId, spec.filters);
  const res = await db.execute(sql`
    WITH ${boundsCte(restaurantId, spec, compare)}, ${invoicesCte(restaurantId, spec.filters)}
    SELECT ${g.key} AS key, MAX(${g.label}) AS label, MAX(${g.labelEn}) AS label_en,
           COALESCE(SUM(ABS(d.delta_amount)), 0) AS leak, COUNT(*) AS c
    FROM per
    JOIN match_runs mr ON mr.invoice_id = per.id AND mr.restaurant_id = ${restaurantId}
    JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
    ${g.join(restaurantId)}
    WHERE ${LF} AND ABS(d.delta_amount) > 0
    GROUP BY 1
    ORDER BY SUM(ABS(d.delta_amount)) DESC, 1
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);
  return rowsOf(res).map((r) => ({
    key: String(r.key ?? ''),
    label: (r.label as string | null) ?? null,
    labelEn: (r.label_en as string | null) ?? null,
    leakIls: ils(r.leak),
    count: n(r.c),
  }));
}

export interface LeakTrendPoint {
  /** Local bucket start as a UTC ISO instant. */
  bucketStart: string;
  leakIls: number;
  spendIls: number;
}

/**
 * Leak and checked spend per bucket (day for ranges up to ~2 months, else
 * month), capped per invoice exactly like the hero — Σ points = the summary.
 */
export async function computeLeakTrend(
  db: Database,
  restaurantId: string,
  spec: ViewSpec,
  compare: ViewCompare = 'off',
): Promise<{ bucket: 'day' | 'month'; points: LeakTrendPoint[] }> {
  const res = await db.execute(sql`
    WITH ${boundsCte(restaurantId, spec, compare)}, ${invoicesCte(restaurantId, spec.filters)},
    g AS (
      SELECT CASE WHEN (SELECT hi - lo FROM b) <= interval '62 days' THEN 'day' ELSE 'month' END AS unit,
             (SELECT tz FROM b) AS tz
    )
    SELECT g.unit,
           date_trunc(g.unit, per.at AT TIME ZONE g.tz) AT TIME ZONE g.tz AS bucket,
           COALESCE(SUM(LEAST(per.raw_leak, per.total)), 0) AS leak,
           COALESCE(SUM(per.total_excl) FILTER (WHERE NOT per.pending_link AND NOT per.dup_copy), 0) AS spend
    FROM per, g
    GROUP BY g.unit, bucket
    ORDER BY bucket
  `);
  const rows = rowsOf(res);
  const unit = rows[0]?.unit === 'month' ? 'month' : 'day';
  return {
    bucket: unit,
    points: rows.map((r) => ({ bucketStart: iso(r.bucket), leakIls: ils(r.leak), spendIls: ils(r.spend) })),
  };
}

/** Invoice ids (+ capped leak) behind a view — used to drive the drill-down list. */
export function viewInvoicesSql(restaurantId: string, spec: ViewSpec): SQL {
  return sql`${boundsCte(restaurantId, spec, 'off')}, ${invoicesCte(restaurantId, spec.filters)}`;
}

/** Suppliers and categories that a filter can offer, for this restaurant. */
export async function computeViewOptions(
  db: Database,
  restaurantId: string,
): Promise<{
  suppliers: Array<{ id: string; name: string; nameEn: string | null }>;
  categories: string[];
}> {
  const [s, c] = await Promise.all([
    db.execute(sql`
      SELECT id, name, name_en FROM suppliers
      WHERE restaurant_id = ${restaurantId} ORDER BY name LIMIT 500
    `),
    db.execute(sql`
      SELECT DISTINCT category FROM products
      WHERE restaurant_id = ${restaurantId} AND category IS NOT NULL AND category <> ''
      ORDER BY category LIMIT 200
    `),
  ]);
  return {
    suppliers: rowsOf(s).map((r) => ({ id: String(r.id), name: String(r.name), nameEn: str(r.name_en) })),
    categories: rowsOf(c).map((r) => String(r.category)),
  };
}

const str = (v: unknown): string | null => (v == null ? null : String(v));
