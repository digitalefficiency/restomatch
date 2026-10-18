import { sql, type Database } from '@restomatch/db';
import { supplierMergeKey } from './chain';

/**
 * "Price disparity across branches": the same supplier charging different
 * branches a different unit price for the same product in the same month.
 *
 * SECURITY CONTRACT (same as chain.ts): `computeBranchPriceLines` is
 * PER-RESTAURANT and must run inside that restaurant's `withRestaurant`
 * transaction; `computePriceDisparities` is pure and only compares rows the
 * caller already read under each branch's RLS. No cross-tenant SQL.
 *
 * Matching is deliberately conservative — a wrong "you pay 12% more" claim
 * kills trust faster than a missed one:
 *   • same supplier = same business id (ח.פ) digits, else the same normalized name;
 *   • same product = the same supplier SKU (`sku`), else the same normalized
 *     product name AND the same unit (`name`);
 *   • a row needs ≥ 2 branches, a spread ≥ 3 % and ≥ ₪5 of impact in the period;
 *   • lines the engine flagged as a price error (PRICE_HIGHER/LOWER warn/block)
 *     are excluded — those are billing mistakes already in the leak figure.
 * Prices are compared as Σ line total ÷ Σ qty (agorot-exact sums).
 */

export interface BranchPriceLine {
  invoiceLineId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  supplierNameEn: string | null;
  supplierBusinessId: string | null;
  productName: string;
  productNameEn: string | null;
  sku: string | null;
  unit: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface BranchPriceLines {
  restaurantId: string;
  name: string;
  lines: BranchPriceLine[];
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/**
 * The month's billed product lines of one branch (checked invoices, i.e. with a
 * match run). MUST run inside `withRestaurant(db, restaurantId)`.
 * `monthStart`/`monthEnd` are the branch-local month bounds (LeakHero.monthStart/End).
 */
export async function computeBranchPriceLines(
  db: Database,
  restaurantId: string,
  name: string,
  bounds: { monthStart: string; monthEnd: string },
): Promise<BranchPriceLines> {
  const res = await db.execute(sql`
    SELECT il.id AS line_id, i.id AS invoice_id, i.invoice_number,
           COALESCE(i.invoice_date, i.created_at) AS invoice_date,
           s.name AS supplier_name, s.name_en AS supplier_name_en, s.business_id,
           p.canonical_name, p.name_en AS product_name_en, il.unit,
           il.qty_billed, il.unit_price_billed, il.line_total,
           (SELECT ci.supplier_sku FROM supplier_catalog_items ci
             WHERE ci.restaurant_id = ${restaurantId} AND ci.supplier_id = i.supplier_id
               AND ci.product_id = il.product_id AND ci.supplier_sku IS NOT NULL
             ORDER BY ci.updated_at DESC LIMIT 1) AS sku
    FROM invoices i
    JOIN invoice_lines il ON il.invoice_id = i.id
    JOIN suppliers s ON s.id = i.supplier_id AND s.restaurant_id = ${restaurantId}
    JOIN products p ON p.id = il.product_id AND p.restaurant_id = ${restaurantId}
    WHERE i.restaurant_id = ${restaurantId}
      AND COALESCE(i.invoice_date, i.created_at) >= ${bounds.monthStart}::timestamptz
      AND COALESCE(i.invoice_date, i.created_at) < ${bounds.monthEnd}::timestamptz
      AND EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = i.id AND mr.restaurant_id = ${restaurantId})
      AND il.qty_billed > 0 AND il.line_total > 0
      -- A line the engine already flagged as a price error is a billing mistake
      -- (counted in the leak), not the branch's price: leave it out, so a
      -- one-off overcharge never reads as "this branch pays X% more".
      AND NOT EXISTS (
        SELECT 1 FROM discrepancies d
        WHERE d.restaurant_id = ${restaurantId} AND d.invoice_line_id = il.id
          AND d.type IN ('PRICE_HIGHER','PRICE_LOWER') AND d.severity IN ('warn','block')
      )
  `);
  return {
    restaurantId,
    name,
    lines: rowsOf(res).map((r) => ({
      invoiceLineId: String(r.line_id),
      invoiceId: String(r.invoice_id),
      invoiceNumber: String(r.invoice_number ?? ''),
      invoiceDate: iso(r.invoice_date),
      supplierName: String(r.supplier_name ?? ''),
      supplierNameEn: str(r.supplier_name_en),
      supplierBusinessId: str(r.business_id),
      productName: String(r.canonical_name ?? ''),
      productNameEn: str(r.product_name_en),
      sku: str(r.sku),
      unit: String(r.unit ?? ''),
      qty: num(r.qty_billed),
      unitPrice: num(r.unit_price_billed),
      lineTotal: num(r.line_total),
    })),
  };
}

export type DisparityMatchMethod = 'sku' | 'name';

export interface DisparityBranchPrice {
  restaurantId: string;
  name: string;
  /** Σ line total ÷ Σ qty, rounded to the agora. */
  avgPrice: number;
  qty: number;
  /** (avgPrice − chain-best price) × qty. */
  impactIls: number;
}

export interface DisparityLine {
  restaurantId: string;
  invoiceLineId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  qty: number;
  unitPrice: number;
}

export interface PriceDisparityRow {
  key: string;
  method: DisparityMatchMethod;
  supplierName: string;
  supplierNameEn: string | null;
  productName: string;
  productNameEn: string | null;
  unit: string;
  cheapest: DisparityBranchPrice;
  priciest: DisparityBranchPrice;
  /** (priciest − cheapest) ÷ cheapest. */
  deltaPct: number;
  /** Σ over branches of (price − chain-best) × qty this month. */
  impactIls: number;
  branches: DisparityBranchPrice[];
  /** Drill-down: the invoice lines behind the prices (priciest first, capped). */
  lines: DisparityLine[];
}

const normName = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["'״׳`.,()\-–—_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const DISPARITY_MIN_PCT = 0.03;
export const DISPARITY_MIN_IMPACT_ILS = 5;

export function computePriceDisparities(
  branches: BranchPriceLines[],
  options: { limit?: number; linesPerRow?: number } = {},
): PriceDisparityRow[] {
  type Acc = {
    method: DisparityMatchMethod;
    sample: BranchPriceLine;
    perBranch: Map<string, { name: string; totalAg: number; qty: number; lines: BranchPriceLine[] }>;
  };
  const groups = new Map<string, Acc>();
  for (const b of branches) {
    for (const l of b.lines) {
      const sup = supplierMergeKey(l.supplierName, l.supplierBusinessId);
      if (!sup || !l.unit) continue;
      const method: DisparityMatchMethod = l.sku ? 'sku' : 'name';
      const prod = l.sku ? `sku:${l.sku.trim().toLowerCase()}` : `name:${normName(l.productName)}|${normName(l.unit)}`;
      if (prod.endsWith(':') || prod.startsWith('name:|')) continue;
      const key = `${sup}|${prod}`;
      let g = groups.get(key);
      if (!g) {
        g = { method, sample: l, perBranch: new Map() };
        groups.set(key, g);
      }
      let pb = g.perBranch.get(b.restaurantId);
      if (!pb) {
        pb = { name: b.name, totalAg: 0, qty: 0, lines: [] };
        g.perBranch.set(b.restaurantId, pb);
      }
      pb.totalAg += Math.round(l.lineTotal * 100);
      pb.qty += l.qty;
      pb.lines.push(l);
    }
  }

  const rows: PriceDisparityRow[] = [];
  for (const [key, g] of groups) {
    if (g.perBranch.size < 2) continue;
    // A SKU match must also agree on the unit (a SKU sold per kg in one branch and per case in another is not comparable).
    const units = new Set([...g.perBranch.values()].flatMap((p) => p.lines.map((l) => normName(l.unit))));
    if (units.size > 1) continue;
    const priced = [...g.perBranch.entries()]
      .filter(([, p]) => p.qty > 0)
      .map(([rid, p]) => ({ rid, p, avgAg: Math.round(p.totalAg / p.qty) }));
    if (priced.length < 2) continue;
    const bestAg = Math.min(...priced.map((x) => x.avgAg));
    const branchesOut: DisparityBranchPrice[] = priced
      .map(({ rid, p, avgAg }) => ({
        restaurantId: rid,
        name: p.name,
        avgPrice: avgAg / 100,
        qty: p.qty,
        impactIls: Math.round((avgAg - bestAg) * p.qty) / 100,
      }))
      .sort((a, b) => b.avgPrice - a.avgPrice);
    const priciest = branchesOut[0]!;
    const cheapest = branchesOut[branchesOut.length - 1]!;
    if (cheapest.avgPrice <= 0) continue;
    const deltaPct = (priciest.avgPrice - cheapest.avgPrice) / cheapest.avgPrice;
    const impactAg = branchesOut.reduce((a, b) => a + Math.round(b.impactIls * 100), 0);
    if (deltaPct < DISPARITY_MIN_PCT || impactAg < DISPARITY_MIN_IMPACT_ILS * 100) continue;
    const order = new Map(branchesOut.map((b, i) => [b.restaurantId, i]));
    const lines = [...g.perBranch.entries()]
      .flatMap(([rid, p]) => p.lines.map((l) => ({ rid, l })))
      .sort((a, b) => (order.get(a.rid)! - order.get(b.rid)!) || b.l.invoiceDate.localeCompare(a.l.invoiceDate))
      .slice(0, options.linesPerRow ?? 12)
      .map(({ rid, l }) => ({
        restaurantId: rid,
        invoiceLineId: l.invoiceLineId,
        invoiceId: l.invoiceId,
        invoiceNumber: l.invoiceNumber,
        invoiceDate: l.invoiceDate,
        qty: l.qty,
        unitPrice: l.unitPrice,
      }));
    rows.push({
      key,
      method: g.method,
      supplierName: g.sample.supplierName,
      supplierNameEn: g.sample.supplierNameEn,
      productName: g.sample.productName,
      productNameEn: g.sample.productNameEn,
      unit: g.sample.unit,
      cheapest,
      priciest,
      deltaPct,
      impactIls: impactAg / 100,
      branches: branchesOut,
      lines,
    });
  }
  return rows.sort((a, b) => b.impactIls - a.impactIls || b.deltaPct - a.deltaPct).slice(0, options.limit ?? 10);
}
