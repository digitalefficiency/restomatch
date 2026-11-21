import { sql, type Database } from '@restomatch/db';
import { lineFilter, viewInvoicesSql, type ViewSpec } from './leak-views';
import { computeLeakComparison, type LeakComparison } from './period';

type SQL = ReturnType<typeof sql>;

/**
 * W2-09c · what moved the leak (exec-desktop-19): the top contributors to the
 * change between the view's window and the same span before it, in agorot,
 * plus an "אחר" remainder so the chips always sum to the hero's Δ to the agora.
 *
 * Each group's amount is the HERO's leak (leak-views.ts): Σ|Δ| of the lines
 * LEAK_FILTER counts, capped per invoice at the invoice total. A chip is a door
 * to the breakdown filtered to its group, and that landing shows the capped
 * figure, so the chip must carry the same one (the drill contract).
 *
 * Cap allocation, in integer agorot: an invoice whose lines sum to R with total
 * T counts C = min(R, T) (a NULL total counts as 0, as in the hero). When C < R
 * each line gets floor(|Δ|·C / R); the agorot left over go one each to the lines
 * with the largest remainders, ties by line id. So Σ lines = C exactly, and
 * Σ over all groups of a window = that window's hero leak.
 */

export const DRIVER_DIMENSIONS = ['supplier', 'product', 'type'] as const;
export type DriverDimension = (typeof DRIVER_DIMENSIONS)[number];

export interface LeakDriver {
  key: string;
  label: string | null;
  labelEn: string | null;
  /** The group's capped leak in the view's window (= the landing total for that group). */
  currentAgorot: number;
  previousAgorot: number;
  /** current − previous (signed): up is worse. */
  deltaAgorot: number;
  /** Relative to the previous amount; null when it was 0. */
  deltaPct: number | null;
}

export interface LeakDrivers {
  by: DriverDimension;
  comparison: LeakComparison;
  drivers: LeakDriver[];
  /** Δ not explained by `drivers`: Σ drivers + other = comparison.deltaAgorot. */
  otherAgorot: number;
}

/** Same keys and labels as the explorer's group-by (leak-views GROUP_SQL). */
const GROUP: Record<DriverDimension, { key: SQL; label: SQL; labelEn: SQL; join: (rid: string) => SQL }> = {
  supplier: {
    key: sql`COALESCE(per.supplier_id::text, '')`,
    label: sql`s.name`,
    labelEn: sql`s.name_en`,
    join: (rid) => sql`LEFT JOIN suppliers s ON s.id = per.supplier_id AND s.restaurant_id = ${rid}`,
  },
  product: {
    key: sql`COALESCE(d.product_id::text, '')`,
    label: sql`p.canonical_name`,
    labelEn: sql`p.name_en`,
    join: (rid) => sql`LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${rid}`,
  },
  type: { key: sql`d.type::text`, label: sql`d.type::text`, labelEn: sql`NULL::text`, join: () => sql`` },
};

export interface CapLine {
  invoiceId: string;
  /** The invoice total in agorot (NULL total → 0). */
  capAgorot: number;
  lineId: string;
  /** |Δ| in agorot, > 0. */
  amountAgorot: number;
  key: string;
  label: string | null;
  labelEn: string | null;
}

export interface CapGroup {
  key: string;
  label: string | null;
  labelEn: string | null;
  agorot: number;
}

/**
 * Σ per group of each invoice's capped leak, allocated to its lines (see the
 * module doc). Pure, deterministic for any input order.
 */
export function allocateCapped(lines: readonly CapLine[]): Map<string, CapGroup> {
  const byInvoice = new Map<string, CapLine[]>();
  for (const l of lines) {
    const list = byInvoice.get(l.invoiceId);
    if (list) list.push(l);
    else byInvoice.set(l.invoiceId, [l]);
  }
  const groups = new Map<string, CapGroup>();
  const add = (l: CapLine, agorot: number) => {
    const g = groups.get(l.key);
    if (g) {
      g.agorot += agorot;
      g.label ??= l.label;
      g.labelEn ??= l.labelEn;
    } else groups.set(l.key, { key: l.key, label: l.label, labelEn: l.labelEn, agorot });
  };
  for (const inv of byInvoice.values()) {
    const raw = inv.reduce((s, l) => s + l.amountAgorot, 0);
    const cap = Math.min(raw, inv[0]!.capAgorot);
    if (cap === raw) {
      for (const l of inv) add(l, l.amountAgorot);
      continue;
    }
    // A negative total (a credit document) caps to a negative leak, as LEAST() does in the hero.
    const sign = cap < 0 ? -1n : 1n;
    const C = BigInt(Math.abs(cap));
    const R = BigInt(raw);
    const shares = inv
      .map((l) => {
        const p = BigInt(l.amountAgorot) * C;
        return { l, base: p / R, rem: p % R };
      })
      .sort((a, b) => (a.rem === b.rem ? (a.l.lineId < b.l.lineId ? -1 : a.l.lineId > b.l.lineId ? 1 : 0) : a.rem > b.rem ? -1 : 1));
    let left = C - shares.reduce((s, x) => s + x.base, 0n);
    for (const x of shares) {
      const extra = left > 0n ? 1n : 0n;
      left -= extra;
      add(x.l, Number(sign * (x.base + extra)));
    }
  }
  return groups;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

/** The view's leak lines with their invoice cap, for one dimension. */
async function capLines(db: Database, restaurantId: string, spec: ViewSpec, by: DriverDimension): Promise<CapLine[]> {
  const g = GROUP[by];
  const res = await db.execute(sql`
    WITH ${viewInvoicesSql(restaurantId, spec)}
    SELECT per.id::text AS invoice_id, ROUND(per.total * 100)::bigint AS cap, d.id::text AS line_id,
           ROUND(ABS(d.delta_amount) * 100)::bigint AS amount,
           ${g.key} AS key, ${g.label} AS label, ${g.labelEn} AS label_en
    FROM per
    JOIN match_runs mr ON mr.invoice_id = per.id AND mr.restaurant_id = ${restaurantId}
    JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
    ${g.join(restaurantId)}
    WHERE ${lineFilter(restaurantId, spec.filters)} AND ABS(d.delta_amount) > 0
  `);
  return rowsOf(res).map((r) => ({
    invoiceId: String(r.invoice_id),
    capAgorot: Number(r.cap ?? 0),
    lineId: String(r.line_id),
    amountAgorot: Number(r.amount),
    key: String(r.key ?? ''),
    label: (r.label as string | null) ?? null,
    labelEn: (r.label_en as string | null) ?? null,
  }));
}

/** Capped leak per group for one window of the view (`previous` = the comparison's previous span). */
export async function computeCappedGroups(
  db: Database,
  restaurantId: string,
  spec: ViewSpec,
  by: DriverDimension,
): Promise<Map<string, CapGroup>> {
  return allocateCapped(await capLines(db, restaurantId, spec, by));
}

export async function computeLeakDrivers(
  db: Database,
  restaurantId: string,
  view: ViewSpec,
  opts: { by?: DriverDimension; top?: number; tz?: string } = {},
): Promise<LeakDrivers> {
  const by = opts.by ?? 'supplier';
  const top = Math.min(Math.max(opts.top ?? 3, 1), 10);
  const spec = { ...view, now: view.now ?? new Date() };
  const comparison = await computeLeakComparison(db, restaurantId, spec, opts.tz);
  const prevSpec: ViewSpec = {
    period: 'custom',
    from: comparison.previous.from,
    to: comparison.previous.to,
    filters: spec.filters,
    now: spec.now,
  };
  const [cur, prev] = await Promise.all([
    computeCappedGroups(db, restaurantId, spec, by),
    computeCappedGroups(db, restaurantId, prevSpec, by),
  ]);
  const map = new Map<string, LeakDriver>();
  const row = (g: CapGroup) => {
    let d = map.get(g.key);
    if (!d) {
      d = { key: g.key, label: g.label, labelEn: g.labelEn, currentAgorot: 0, previousAgorot: 0, deltaAgorot: 0, deltaPct: null };
      map.set(g.key, d);
    }
    d.label ??= g.label;
    d.labelEn ??= g.labelEn;
    return d;
  };
  for (const g of cur.values()) row(g).currentAgorot = g.agorot;
  for (const g of prev.values()) row(g).previousAgorot = g.agorot;
  const all = [...map.values()].map((d) => ({
    ...d,
    deltaAgorot: d.currentAgorot - d.previousAgorot,
    deltaPct: d.previousAgorot > 0 ? (d.currentAgorot - d.previousAgorot) / d.previousAgorot : null,
  }));
  const drivers = all
    .filter((d) => d.deltaAgorot !== 0)
    .sort((a, b) => Math.abs(b.deltaAgorot) - Math.abs(a.deltaAgorot) || a.key.localeCompare(b.key))
    .slice(0, top);
  const otherAgorot = comparison.deltaAgorot - drivers.reduce((s, d) => s + d.deltaAgorot, 0);
  return { by, comparison, drivers, otherAgorot };
}
