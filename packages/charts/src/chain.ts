import { and, eq, inArray, suppliers, type Database } from '@restomatch/db';
import { computeLeakHero } from './leak-hero';
import { computeLeakReport, parseReportMonth } from './leak-report';
import { computeOwnerKpis } from './owner-kpis';

/**
 * Chain ("רשת") view: the same per-restaurant leak story, summed over the
 * branches an owner runs.
 *
 * SECURITY CONTRACT — read before changing anything here:
 *  • `computeBranchSnapshot` is a PER-RESTAURANT function. The caller must run
 *    it inside that restaurant's own `withRestaurant(db, rid)` transaction, so
 *    every statement underneath is RLS-scoped to that one tenant. It only
 *    composes the existing charts SQL (leak report / hero / owner KPIs).
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

export interface BranchSnapshot {
  restaurantId: string;
  name: string;
  /** 'YYYY-MM' of the reported month. */
  month: string;
  /** Branch-local month bounds (UTC ISO), [monthStart, monthEnd). */
  monthStart: string;
  monthEnd: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  /** Lines approved to claim back (accepted / resolved). */
  claimedIls: number;
  /** Discrepancies awaiting a decision right now (all months — the approvals queue). */
  pendingApprovals: number;
  /** The month's discrepancy lines still open / escalated. */
  openDiscrepancies: number;
  invoiceCount: number;
  pendingLinkCount: number;
  /** Oldest → newest, ending with the reported month. */
  trend: BranchMonthPoint[];
  suppliers: BranchSupplierRow[];
}

export interface ComputeBranchSnapshotOptions {
  /** 'YYYY-MM' — the reported month. */
  month: string;
  /** Months in the trend/heatmap, including `month` (1..12, default 6). */
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

/**
 * One branch's numbers for `month`. MUST run inside `withRestaurant(db, restaurantId)`.
 */
export async function computeBranchSnapshot(
  db: Database,
  restaurantId: string,
  name: string,
  options: ComputeBranchSnapshotOptions,
): Promise<BranchSnapshot> {
  const trendMonths = Math.min(Math.max(options.trendMonths ?? 6, 1), 12);
  const report = await computeLeakReport(db, restaurantId, options.month, { priceCreepLimit: 1 });
  const kpis = await computeOwnerKpis(db, restaurantId);

  const trend: BranchMonthPoint[] = [];
  for (let i = trendMonths - 1; i >= 1; i -= 1) {
    const m = shiftMonth(options.month, -i);
    const hero = await computeLeakHero(db, restaurantId, { now: monthAnchor(m) });
    trend.push({ month: m, leakIls: hero.leakIls, spendIls: hero.spendIls, leakPct: hero.leakPct });
  }
  trend.push({
    month: options.month,
    leakIls: report.hero.leakIls,
    spendIls: report.hero.spendIls,
    leakPct: report.hero.leakPct,
  });

  const supplierIds = report.bySupplier
    .map((s) => s.supplierId)
    .filter((id): id is string => id !== null);
  const ids = supplierIds.length
    ? await db
        .select({ id: suppliers.id, businessId: suppliers.businessId })
        .from(suppliers)
        .where(and(eq(suppliers.restaurantId, restaurantId), inArray(suppliers.id, supplierIds)))
    : [];
  const businessIdOf = new Map(ids.map((r) => [r.id, r.businessId]));

  return {
    restaurantId,
    name,
    month: options.month,
    monthStart: report.hero.monthStart,
    monthEnd: report.hero.monthEnd,
    leakIls: report.hero.leakIls,
    spendIls: report.hero.spendIls,
    leakPct: report.hero.leakPct,
    caughtBeforePaymentIls: report.hero.caughtBeforePaymentIls,
    claimedIls: report.status.claimedIls,
    pendingApprovals: kpis.pendingApprovalsCount,
    openDiscrepancies: report.status.stillOpenCount,
    invoiceCount: report.hero.invoiceCount,
    pendingLinkCount: report.hero.pendingLinkCount,
    trend,
    suppliers: report.bySupplier.map((s) => ({
      supplierId: s.supplierId,
      name: s.supplierName,
      nameEn: s.supplierNameEn,
      businessId: s.supplierId ? (businessIdOf.get(s.supplierId) ?? null) : null,
      invoiceCount: s.invoiceCount,
      spendIls: s.spendIls,
      leakIls: s.leakIls,
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
  /** 1 = the most leak ₪ this month. */
  rank: number;
  prevLeakIls: number;
  prevLeakPct: number | null;
  /** leak ₪ this month − previous month. */
  leakDeltaIls: number;
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
  prevLeakIls: number;
  prevLeakPct: number | null;
}

export interface ChainOverview {
  month: string;
  /** Oldest → newest months of the heatmap. */
  months: string[];
  totals: ChainTotals;
  branches: ChainBranchRow[];
  /** branch × month leak matrix, rows in `branches` order, columns in `months` order. */
  heatmap: { restaurantId: string; cells: BranchMonthPoint[] }[];
  topSuppliers: ChainSupplierRow[];
  /** The branch with the highest leak % this month (ties → more ₪); null when nobody leaked. */
  worstBranchId: string | null;
}

export function aggregateChain(
  snapshots: BranchSnapshot[],
  options: { month: string; topSuppliers?: number },
): ChainOverview {
  const month = options.month;
  const months = snapshots[0]?.trend.map((p) => p.month) ?? [month];
  const prevMonth = shiftMonth(month, -1);
  const prevOf = (s: BranchSnapshot) => s.trend.find((p) => p.month === prevMonth);

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
    const p = prevOf(s);
    prevLeak += ag(p?.leakIls ?? 0);
    prevSpend += ag(p?.spendIls ?? 0);
  }

  const ranked = [...snapshots].sort(
    (a, b) => b.leakIls - a.leakIls || (b.leakPct ?? 0) - (a.leakPct ?? 0) || a.name.localeCompare(b.name),
  );
  const branches: ChainBranchRow[] = ranked.map((s, i) => {
    const p = prevOf(s);
    const prevLeakIls = p?.leakIls ?? 0;
    return {
      ...s,
      rank: i + 1,
      prevLeakIls,
      prevLeakPct: p?.leakPct ?? null,
      leakDeltaIls: ils(ag(s.leakIls) - ag(prevLeakIls)),
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
    month,
    months,
    totals: {
      leakIls: ils(leak),
      spendIls: ils(spend),
      leakPct: pct(leak, spend),
      caughtBeforePaymentIls: ils(caught),
      claimedIls: ils(claimed),
      pendingApprovals: pending,
      openDiscrepancies: open,
      prevLeakIls: ils(prevLeak),
      prevLeakPct: pct(prevLeak, prevSpend),
    },
    branches,
    heatmap: branches.map((b) => ({ restaurantId: b.restaurantId, cells: b.trend })),
    topSuppliers,
    worstBranchId: worst?.restaurantId ?? null,
  };
}
