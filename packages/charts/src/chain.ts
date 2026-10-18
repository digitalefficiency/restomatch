import { sql, type Database } from '@restomatch/db';
import { computeLeakHero } from './leak-hero';
import { parseReportMonth } from './leak-report';
import { computeLeakSummary, viewInvoicesSql, type ViewCompare, type ViewSpec } from './leak-views';
import { computeOwnerKpis } from './owner-kpis';

/**
 * Chain ("רשת") view: the same per-restaurant leak story, summed over the
 * branches an owner runs.
 *
 * SECURITY CONTRACT — read before changing anything here:
 *  • `computeBranchSnapshot` is a PER-RESTAURANT function. The caller must run
 *    it inside that restaurant's own `withRestaurant(db, rid)` transaction, so
 *    every statement underneath is RLS-scoped to that one tenant. It composes
 *    the existing charts SQL (view summary / hero / owner KPIs) and two
 *    per-branch queries over the same view CTEs (`viewInvoicesSql`).
 *  • `aggregateChain` is PURE: it sums snapshots the caller already computed
 *    under RLS. There is deliberately no cross-tenant SQL in this file.
 *
 * Money is summed in integer agorot (never float shekel sums), the chain
 * leak % is Σleak ÷ Σspend (not an average of branch percentages).
 */

export interface BranchMonthPoint {
  /** 'YYYY-MM' */
  month: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
}

export interface BranchSupplierRow {
  supplierId: string | null;
  name: string | null;
  nameEn: string | null;
  businessId: string | null;
  invoiceCount: number;
  spendIls: number;
  leakIls: number;
}

export interface BranchPeriodTotals {
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
}

export interface BranchSnapshot {
  restaurantId: string;
  name: string;
  /** Branch-local bounds of the selected period (UTC ISO), [periodStart, periodEnd). */
  periodStart: string;
  periodEnd: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  /** Leak the team accepted as a claim (accepted / resolved), capped like the hero. */
  claimedIls: number;
  /** Discrepancies awaiting a decision right now (all periods — the approvals queue). */
  pendingApprovals: number;
  /** The period's leak lines still open / escalated. */
  openDiscrepancies: number;
  invoiceCount: number;
  pendingLinkCount: number;
  /** The comparison period (shared view control `compare`); null when compare is off. */
  previous: BranchPeriodTotals | null;
  /** Monthly heatmap, oldest → newest, ending with the month the period ends in. */
  trend: BranchMonthPoint[];
  suppliers: BranchSupplierRow[];
}

export interface ComputeBranchSnapshotOptions {
  /** The shared dashboard view (period / custom range). Filters are not used here. */
  spec: Pick<ViewSpec, 'period' | 'from' | 'to' | 'now'>;
  compare?: ViewCompare;
  /** Months in the heatmap (1..12, default 6). */
  trendMonths?: number;
}

/** 'YYYY-MM' shifted by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const { year, month: m } = parseReportMonth(month);
  const idx = year * 12 + (m - 1) + delta;
  const y = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${y}-${String(mm).padStart(2, '0')}`;
}

/** Mid-month noon UTC: inside the same local month in every real timezone (see leak-report). */
function monthAnchor(month: string): Date {
  const { year, month: m } = parseReportMonth(month);
  return new Date(Date.UTC(year, m - 1, 15, 12, 0, 0));
}

/** 'YYYY-MM' of the local month that contains the last instant before `endIso`. */
export function monthOfPeriodEnd(endIso: string, timezone = 'Asia/Jerusalem'): string {
  const last = new Date(new Date(endIso).getTime() - 1);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' }).formatToParts(last);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const money = (v: unknown): number => Math.round(num(v) * 100) / 100;
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

const COUNTS_AS_LEAK = sql`d.severity IN ('warn','block') AND d.type NOT IN ('PRICE_LOWER','UNORDERED_ARRIVAL') AND ABS(d.delta_amount) > 0`;

/**
 * One branch's numbers for the selected period. MUST run inside
 * `withRestaurant(db, restaurantId)`. Same rules as the hero / view summary
 * (packages/charts/src/leak-views.ts): leak capped per invoice, spend = checked
 * invoices, local calendar bounds in the branch's timezone.
 */
export async function computeBranchSnapshot(
  db: Database,
  restaurantId: string,
  name: string,
  options: ComputeBranchSnapshotOptions,
): Promise<BranchSnapshot> {
  const trendMonths = Math.min(Math.max(options.trendMonths ?? 6, 1), 12);
  const compare = options.compare ?? 'off';
  const spec: ViewSpec = { period: options.spec.period, from: options.spec.from, to: options.spec.to, now: options.spec.now };
  const current = await computeLeakSummary(db, restaurantId, spec);
  const previous = compare === 'off' ? null : await computeLeakSummary(db, restaurantId, spec, compare);
  const kpis = await computeOwnerKpis(db, restaurantId);

  const [supplierRes, openRes] = await Promise.all([
    db.execute(sql`
      WITH ${viewInvoicesSql(restaurantId, spec)}
      SELECT per.supplier_id, s.name, s.name_en, s.business_id,
        COUNT(*) FILTER (WHERE NOT per.pending_link) AS invoice_count,
        COALESCE(SUM(per.total_excl) FILTER (WHERE NOT per.pending_link), 0) AS spend,
        COALESCE(SUM(LEAST(per.raw_leak, per.total)), 0) AS leak
      FROM per
      LEFT JOIN suppliers s ON s.id = per.supplier_id AND s.restaurant_id = ${restaurantId}
      GROUP BY per.supplier_id, s.name, s.name_en, s.business_id
      HAVING COUNT(*) FILTER (WHERE NOT per.pending_link) > 0
    `),
    db.execute(sql`
      WITH ${viewInvoicesSql(restaurantId, spec)}
      SELECT COUNT(*) AS c
      FROM per
      JOIN match_runs mr ON mr.invoice_id = per.id AND mr.restaurant_id = ${restaurantId}
      JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
      WHERE ${COUNTS_AS_LEAK} AND d.resolution_status IN ('open','escalated')
    `),
  ]);

  // The heatmap ends with the period's last month, but never in the future.
  const periodEndMonth = monthOfPeriodEnd(current.monthEnd);
  const nowMonth = monthOfPeriodEnd(new Date((spec.now ?? new Date()).getTime() + 1).toISOString());
  const endMonth = periodEndMonth < nowMonth ? periodEndMonth : nowMonth;
  const trend: BranchMonthPoint[] = [];
  for (let i = trendMonths - 1; i >= 0; i -= 1) {
    const m = shiftMonth(endMonth, -i);
    const hero = await computeLeakHero(db, restaurantId, { now: monthAnchor(m) });
    trend.push({ month: m, leakIls: hero.leakIls, spendIls: hero.spendIls, leakPct: hero.leakPct });
  }

  return {
    restaurantId,
    name,
    periodStart: current.monthStart,
    periodEnd: current.monthEnd,
    leakIls: current.leakIls,
    spendIls: current.spendIls,
    leakPct: current.leakPct,
    caughtBeforePaymentIls: current.caughtBeforePaymentIls,
    claimedIls: current.recoveredIls,
    pendingApprovals: kpis.pendingApprovalsCount,
    openDiscrepancies: num(rowsOf(openRes)[0]?.c),
    invoiceCount: current.invoiceCount,
    pendingLinkCount: current.pendingLinkCount,
    previous: previous
      ? { leakIls: previous.leakIls, spendIls: previous.spendIls, leakPct: previous.leakPct }
      : null,
    trend,
    suppliers: rowsOf(supplierRes).map((r) => ({
      supplierId: strOrNull(r.supplier_id),
      name: strOrNull(r.name),
      nameEn: strOrNull(r.name_en),
      businessId: strOrNull(r.business_id),
      invoiceCount: num(r.invoice_count),
      spendIls: money(r.spend),
      leakIls: money(r.leak),
    })),
  };
}

/* ── Pure aggregation ─────────────────────────────────────────────────────── */

const ag = (ils: number): number => Math.round(ils * 100);
const ils = (agorot: number): number => agorot / 100;
const pct = (leakAg: number, spendAg: number): number | null =>
  spendAg > 0 ? leakAg / spendAg : null;

/**
 * "Same supplier" across branches: the digits of its business id (ח.פ / ע.מ)
 * when known, else a normalized name. Returns null when neither is usable.
 */
export function supplierMergeKey(name: string | null, businessId: string | null): string | null {
  const digits = (businessId ?? '').replace(/\D/g, '');
  if (digits.length >= 5) return `bid:${digits}`;
  if (!name) return null;
  const norm = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(^|\s)בע["״']?מ(?=\s|$)/g, ' ')
    .replace(/\b(ltd|inc|llc)\b\.?/g, ' ')
    .replace(/["'״׳`.,()\-–—_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return norm ? `name:${norm}` : null;
}

export interface ChainBranchRow extends BranchSnapshot {
  /** 1 = the most leak ₪ in the period. */
  rank: number;
  prevLeakIls: number | null;
  prevLeakPct: number | null;
  /** leak ₪ in the period − the comparison period; null when compare is off. */
  leakDeltaIls: number | null;
}

export interface ChainSupplierRow {
  key: string;
  name: string | null;
  nameEn: string | null;
  businessId: string | null;
  branchCount: number;
  branchIds: string[];
  invoiceCount: number;
  spendIls: number;
  leakIls: number;
  leakPct: number | null;
}

export interface ChainTotals {
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  claimedIls: number;
  pendingApprovals: number;
  openDiscrepancies: number;
  /** The comparison period's totals; null when compare is off. */
  prevLeakIls: number | null;
  prevLeakPct: number | null;
}

export interface ChainOverview {
  /** Bounds of the selected period (from the first branch; every IL branch shares a timezone). */
  periodStart: string | null;
  periodEnd: string | null;
  /** Oldest → newest months of the heatmap. */
  months: string[];
  totals: ChainTotals;
  branches: ChainBranchRow[];
  /** branch × month leak matrix, rows in `branches` order, columns in `months` order. */
  heatmap: { restaurantId: string; cells: BranchMonthPoint[] }[];
  topSuppliers: ChainSupplierRow[];
  /** The branch with the highest leak % in the period (ties → more ₪); null when nobody leaked. */
  worstBranchId: string | null;
}

export function aggregateChain(
  snapshots: BranchSnapshot[],
  options: { topSuppliers?: number } = {},
): ChainOverview {
  const months = snapshots[0]?.trend.map((p) => p.month) ?? [];
  const compared = snapshots.length > 0 && snapshots.every((s) => s.previous !== null);

  let leak = 0;
  let spend = 0;
  let caught = 0;
  let claimed = 0;
  let prevLeak = 0;
  let prevSpend = 0;
  let pending = 0;
  let open = 0;
  for (const s of snapshots) {
    leak += ag(s.leakIls);
    spend += ag(s.spendIls);
    caught += ag(s.caughtBeforePaymentIls);
    claimed += ag(s.claimedIls);
    pending += s.pendingApprovals;
    open += s.openDiscrepancies;
    prevLeak += ag(s.previous?.leakIls ?? 0);
    prevSpend += ag(s.previous?.spendIls ?? 0);
  }

  // A comparison period with no checked spend and no leak has nothing to compare
  // against: no delta (not "▲ the whole leak"), same as the KPI's null %.
  const comparable = (p: BranchPeriodTotals | null): p is BranchPeriodTotals =>
    p !== null && (p.spendIls > 0 || p.leakIls > 0);
  const ranked = [...snapshots].sort(
    (a, b) => b.leakIls - a.leakIls || (b.leakPct ?? 0) - (a.leakPct ?? 0) || a.name.localeCompare(b.name),
  );
  const branches: ChainBranchRow[] = ranked.map((s, i) => {
    const p = comparable(s.previous) ? s.previous : null;
    return {
      ...s,
      rank: i + 1,
      prevLeakIls: p ? p.leakIls : null,
      prevLeakPct: p ? p.leakPct : null,
      leakDeltaIls: p ? ils(ag(s.leakIls) - ag(p.leakIls)) : null,
    };
  });

  const worst = [...snapshots]
    .filter((s) => s.leakIls > 0)
    .sort((a, b) => (b.leakPct ?? 0) - (a.leakPct ?? 0) || b.leakIls - a.leakIls)[0];

  const bySupplier = new Map<
    string,
    { row: ChainSupplierRow; leakAg: number; spendAg: number; branches: Set<string> }
  >();
  for (const s of snapshots) {
    for (const sup of s.suppliers) {
      const key = supplierMergeKey(sup.name, sup.businessId) ?? `id:${s.restaurantId}:${sup.supplierId ?? '-'}`;
      let acc = bySupplier.get(key);
      if (!acc) {
        acc = {
          row: {
            key,
            name: sup.name,
            nameEn: sup.nameEn,
            businessId: sup.businessId,
            branchCount: 0,
            branchIds: [],
            invoiceCount: 0,
            spendIls: 0,
            leakIls: 0,
            leakPct: null,
          },
          leakAg: 0,
          spendAg: 0,
          branches: new Set(),
        };
        bySupplier.set(key, acc);
      }
      acc.row.nameEn ??= sup.nameEn;
      acc.row.businessId ??= sup.businessId;
      acc.leakAg += ag(sup.leakIls);
      acc.spendAg += ag(sup.spendIls);
      acc.row.invoiceCount += sup.invoiceCount;
      acc.branches.add(s.restaurantId);
    }
  }
  const topSuppliers = [...bySupplier.values()]
    .map(({ row, leakAg, spendAg, branches: b }) => ({
      ...row,
      branchIds: [...b],
      branchCount: b.size,
      leakIls: ils(leakAg),
      spendIls: ils(spendAg),
      leakPct: pct(leakAg, spendAg),
    }))
    .filter((r) => r.leakIls > 0)
    .sort((a, b) => b.leakIls - a.leakIls || b.branchCount - a.branchCount)
    .slice(0, options.topSuppliers ?? 8);

  return {
    periodStart: snapshots[0]?.periodStart ?? null,
    periodEnd: snapshots[0]?.periodEnd ?? null,
    months,
    totals: {
      leakIls: ils(leak),
      spendIls: ils(spend),
      leakPct: pct(leak, spend),
      caughtBeforePaymentIls: ils(caught),
      claimedIls: ils(claimed),
      pendingApprovals: pending,
      openDiscrepancies: open,
      prevLeakIls: compared ? ils(prevLeak) : null,
      prevLeakPct: compared ? pct(prevLeak, prevSpend) : null,
    },
    branches,
    heatmap: branches.map((b) => ({ restaurantId: b.restaurantId, cells: b.trend })),
    topSuppliers,
    worstBranchId: worst?.restaurantId ?? null,
  };
}
