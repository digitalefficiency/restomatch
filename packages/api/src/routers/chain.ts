import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  aggregateChain,
  computeBranchPriceLines,
  computeBranchSnapshot,
  computeLeakBreakdown,
  computeLeakGrouped,
  computeLeakSummary,
  computePriceDisparities,
  VIEW_COMPARES,
  VIEW_PERIODS,
  type BranchMonthPoint,
  type BranchSnapshot,
  type ChainOverview,
  type ChainTotals,
  type PriceDisparityRow,
} from '@restomatch/charts';
import {
  and,
  billingAccounts,
  eq,
  memberships,
  products,
  restaurants,
  sql,
  storageNamespaces,
  supplierCatalogItems,
  suppliers,
  withRestaurant,
  withUser,
  type Database,
  type UserRole,
} from '@restomatch/db';
import { recordAudit } from '../audit';
import type { AuthedContext } from '../context';
import { getEntitlements, type Entitlements } from '../entitlements';
import { featureEnabled } from '../lib/features';
import { isFeatureOn } from '../lib/featureGate';
import { computeRecoverySummary } from '../recovery/service';
import { computeQueueSummary } from './approvals';
import { computePayRunMonth } from './payRun';
import { authedProcedure, router } from '../trpc';
import { hasNoControlChars, NO_CONTROL_CHARS_MESSAGE } from '../lib/text';

/**
 * Chain ("רשת") + branches (סניפים). See docs/client-ready/chain-design.md.
 *
 *  • Branch = a restaurant. Chain = the restaurants on the ACTIVE branch's
 *    billing account where the caller is an OWNER (DB membership).
 *  • The caller's memberships are read under RLS (`withUser`: memberships_self
 *    + restaurants_member_select) — only the caller's own rows are visible.
 *  • Every number is computed per branch inside that branch's own
 *    `withRestaurant` transaction with the existing charts SQL; summing happens
 *    in TS (`aggregateChain`). No cross-tenant SQL.
 *  • A restaurant id from input is only ever used after it is found in that
 *    RLS-derived membership set; otherwise NOT_FOUND (no existence oracle).
 *
 * These procedures are deliberately NOT member procedures: a member procedure
 * runs inside ONE tenant transaction, and the chain view needs one transaction
 * per branch.
 */

/** Hard cap on branches computed per request (the chain plan allows 5). */
export const MAX_CHAIN_BRANCHES = 25;
/** Branch transactions in flight at once (the web pool has max 10 connections). */
const BRANCH_CONCURRENCY = 3;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day in 2000–2100 (Postgres throws on 2026-02-30). */
const realDate = (v: string) => {
  const y = Number(v.slice(0, 4));
  const d = new Date(`${v}T00:00:00Z`);
  return y >= 2000 && y <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/**
 * The shared dashboard view (apps/web/lib/components/views): period + custom
 * range + compare. Chain numbers are whole-branch, so view filters are not
 * accepted here (a supplier id is per-branch anyway).
 */
const ChainViewInput = z
  .object({
    period: z.enum(VIEW_PERIODS).default('this_month'),
    from: z.string().regex(ISO_DATE).refine(realDate, 'not a calendar date').optional(),
    to: z.string().regex(ISO_DATE).refine(realDate, 'not a calendar date').optional(),
  })
  .strict()
  .refine((v) => v.period !== 'custom' || (!!v.from && !!v.to), { message: 'custom period needs from and to' })
  .refine((v) => !v.from || !v.to || Math.abs(Date.parse(v.to) - Date.parse(v.from)) <= 3 * 366 * 86_400_000, {
    message: 'custom range is limited to 3 years',
  });

/** Stable message of the "only the billing account's payer may add branches" refusal. */
export const NOT_BILLING_OWNER = 'NOT_BILLING_OWNER';
const BRANCH_NAME = z.string().trim().min(2).max(120).refine(hasNoControlChars, NO_CONTROL_CHARS_MESSAGE);

export interface MembershipRow {
  restaurantId: string;
  name: string;
  role: UserRole;
  billingAccountId: string | null;
}

export interface ChainBranch {
  restaurantId: string;
  name: string;
  isActive: boolean;
}

export interface ChainScope {
  active: MembershipRow;
  /** Owner branches on the active branch's billing account (always includes the active one). */
  branches: MembershipRow[];
}

/** The caller's memberships, read under the user-scoped RLS policies. */
export async function myMembershipRows(db: Database, userId: string): Promise<MembershipRow[]> {
  return withUser(db, userId, (tx) =>
    tx
      .select({
        restaurantId: memberships.restaurantId,
        name: restaurants.name,
        role: memberships.role,
        billingAccountId: restaurants.billingAccountId,
      })
      .from(memberships)
      .innerJoin(restaurants, eq(memberships.restaurantId, restaurants.id))
      .where(eq(memberships.userId, userId)),
  );
}

/**
 * The chain rule, pure: owner of the active branch, then every OWNER membership
 * on the same (non-null) billing account. Throws FORBIDDEN otherwise.
 */
export function chainScopeOf(rows: MembershipRow[], activeRestaurantId: string | null): ChainScope {
  const active = rows.find((r) => r.restaurantId === activeRestaurantId);
  if (!active || active.role !== 'owner') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'chain view is owner-only' });
  }
  const branches = active.billingAccountId
    ? rows.filter((r) => r.role === 'owner' && r.billingAccountId === active.billingAccountId)
    : [active];
  branches.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return { active, branches };
}

async function resolveScope(ctx: AuthedContext): Promise<ChainScope> {
  const rows = await myMembershipRows(ctx.db, ctx.session.userId);
  return chainScopeOf(rows, ctx.session.restaurantId);
}

/** Run `fn` in the branch's own RLS transaction (restaurant + user GUCs). */
function inBranch<T>(
  db: Database,
  userId: string,
  restaurantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withRestaurant(db, restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}


function chainRequired(planKey: string | null): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: 'ENTITLEMENT_REQUIRED:chain',
    cause: { code: 'ENTITLEMENT_REQUIRED', feature: 'chain', planKey },
  });
}

interface Gate {
  entitlements: Entitlements;
  /** Chain dashboard available: the chain plan, or already more than one branch. */
  chainEnabled: boolean;
  /** Max branches on the account (null = unlimited). */
  branchLimit: number | null;
  canAddBranch: boolean;
  isBillingOwner: boolean;
  /** Per-restaurant feature flag (settings.features.priceDisparity) of the active branch. */
  priceDisparity: boolean;
  /** Per-restaurant feature flag (settings.features.chainAlerts) of the active branch. */
  chainAlerts: boolean;
}

function gateOf(
  ent: Entitlements,
  branchCount: number,
  isPayer: boolean,
  settings: unknown,
): Gate {
  const branchLimit = ent.limits.restaurants;
  return {
    entitlements: ent,
    chainEnabled:
      (ent.active && ent.planKey === 'chain') || branchCount > 1 || featureEnabled(settings, 'chain'),
    priceDisparity: featureEnabled(settings, 'priceDisparity'),
    chainAlerts: featureEnabled(settings, 'chainAlerts'),
    branchLimit,
    canAddBranch:
      ent.active &&
      ent.billingAccountId !== null &&
      isPayer &&
      (branchLimit === null || branchCount < branchLimit),
    isBillingOwner: isPayer,
  };
}

async function gateFor(ctx: AuthedContext, scope: ChainScope): Promise<Gate> {
  const { ent, payer, settings } = await inBranch(ctx.db, ctx.session.userId, scope.active.restaurantId, async (tx) => {
    const e = await getEntitlements(tx, scope.active.restaurantId);
    const [acct] = e.billingAccountId
      ? await tx
          .select({ ownerUserId: billingAccounts.ownerUserId })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, e.billingAccountId))
          .limit(1)
      : [];
    const [r] = await tx
      .select({ settings: restaurants.settings })
      .from(restaurants)
      .where(eq(restaurants.id, scope.active.restaurantId))
      .limit(1);
    return { ent: e, payer: acct?.ownerUserId ?? null, settings: r?.settings ?? {} };
  });
  return gateOf(ent, scope.branches.length, payer === ctx.session.userId, settings);
}

export interface ChainBranchesResult {
  activeRestaurantId: string;
  branches: ChainBranch[];
  planKey: Entitlements['planKey'];
  hasBillingAccount: boolean;
  chainEnabled: boolean;
  branchLimit: number | null;
  canAddBranch: boolean;
  /** The caller pays for this billing account (only the payer may add branches). */
  isBillingOwner: boolean;
}

export interface ChainOverviewResult extends ChainOverview {
  activeRestaurantId: string;
  /** True when the chain had more than MAX_CHAIN_BRANCHES owner branches. */
  truncated: boolean;
  /** The comparison actually applied (the shared view control). */
  compare: (typeof VIEW_COMPARES)[number];
  /** Same supplier + product at different prices across branches; null when the feature is off. */
  priceDisparities: PriceDisparityRow[] | null;
}

/** A branch only becomes "the one to look at" with at least this much leak in the week. */
export const ALERT_MIN_LEAK_ILS = 50;
/** Days in the alerts window, ending today (local). */
const ALERT_DAYS = 7;

/** 'YYYY-MM-DD' of `d` on the Israel wall clock (the custom view bounds are local dates). */
function localYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The alerts window: the last 7 local days, today included. */
export function alertWeek(now: Date): { from: string; to: string } {
  const to = localYmd(now);
  const from = new Date(`${to}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - (ALERT_DAYS - 1));
  return { from: from.toISOString().slice(0, 10), to };
}

export interface ChainAlertBranch {
  restaurantId: string;
  name: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  /** The discrepancy type with the most leak ₪ in the window (null = no leak). */
  topDriver: { type: string; leakIls: number; count: number } | null;
}

export interface ChainAlertsResult {
  /** False when the chainAlerts flag is off for the active branch (nothing else is computed). */
  enabled: boolean;
  from: string | null;
  to: string | null;
  /** The branch to look at this week: most leak ₪ (≥ ALERT_MIN_LEAK_ILS); null = all calm. */
  focus: ChainAlertBranch | null;
  /** Every branch, most leak ₪ first. */
  branches: ChainAlertBranch[];
}

/** Pure: rank branches and pick the focus branch. */
export function pickAlertFocus(branches: ChainAlertBranch[]): { focus: ChainAlertBranch | null; branches: ChainAlertBranch[] } {
  const ranked = [...branches].sort(
    (a, b) => b.leakIls - a.leakIls || (b.leakPct ?? 0) - (a.leakPct ?? 0) || a.name.localeCompare(b.name, 'he'),
  );
  const top = ranked[0];
  return { focus: top && top.leakIls >= ALERT_MIN_LEAK_ILS ? top : null, branches: ranked };
}


/* ── W3-01 · branch scope + the roll-up matrix ─────────────────────────────── */

/**
 * The URL scope `b=all|<restaurantId>|g:<group>`. Group = billing account (no
 * group table, PROGRAMME-PLAN §5.3). Anything that does not parse is `all`:
 * a broken link widens nothing — the server still limits it to the caller's
 * own memberships.
 */
export type BranchScope =
  | { kind: 'all' }
  | { kind: 'branch'; restaurantId: string }
  | { kind: 'group'; billingAccountId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBranchScope(raw: unknown): BranchScope {
  if (typeof raw !== 'string') return { kind: 'all' };
  const v = raw.trim();
  if (UUID.test(v)) return { kind: 'branch', restaurantId: v.toLowerCase() };
  if (v.startsWith('g:') && UUID.test(v.slice(2))) return { kind: 'group', billingAccountId: v.slice(2).toLowerCase() };
  return { kind: 'all' };
}

/** Roles that may READ the chain matrix. Writes (rename / add branch) stay owner-only. */
export const MATRIX_READ_ROLES: ReadonlyArray<UserRole> = ['owner', 'bookkeeper'];

export interface MatrixScope {
  active: MembershipRow;
  /** The caller's role on the active branch; every listed branch has the same role. */
  lens: UserRole;
  /** Every branch the lens reaches on the active billing account (the "כל הסניפים" set). */
  pool: MembershipRow[];
  /** The branches the requested scope selects (a subset of `pool`). */
  branches: MembershipRow[];
}

/**
 * The matrix rule, pure. The active branch must be an owner or bookkeeper
 * membership (decision 7: the bookkeeper reads everything, read-only). The pool
 * is every membership of THAT same role on the same non-null billing account
 * (else just the active branch). An id or group the pool does not hold →
 * NOT_FOUND, the same answer for "exists but not yours" and "does not exist".
 */
export function resolveMatrixScope(
  rows: MembershipRow[],
  activeRestaurantId: string | null,
  scope: BranchScope,
): MatrixScope {
  // A user may hold several roles on one branch (PK user+restaurant+role): owner wins, then bookkeeper.
  const active = MATRIX_READ_ROLES.map((role) =>
    rows.find((r) => r.restaurantId === activeRestaurantId && r.role === role),
  ).find((r) => r !== undefined);
  if (!active) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'chain matrix is owner / bookkeeper only' });
  }
  const pool = active.billingAccountId
    ? rows.filter((r) => r.role === active.role && r.billingAccountId === active.billingAccountId)
    : [active];
  pool.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  let branches = pool;
  if (scope.kind === 'branch') {
    branches = pool.filter((r) => r.restaurantId === scope.restaurantId);
  } else if (scope.kind === 'group' && scope.billingAccountId !== active.billingAccountId) {
    branches = [];
  }
  if (branches.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'branch not found' });
  return { active, lens: active.role, pool, branches };
}

/** T4 no data · pending (only invoices waiting to link) · T3 clean · leak. */
export type MatrixCellState = 'no_data' | 'pending' | 'clean' | 'leak';

export function matrixCellState(s: Pick<BranchSnapshot, 'invoiceCount' | 'pendingLinkCount' | 'leakIls' | 'spendIls'>): MatrixCellState {
  if (s.leakIls > 0) return 'leak';
  if (s.invoiceCount > 0 && s.spendIls > 0) return 'clean';
  if (s.pendingLinkCount > 0) return 'pending';
  return 'no_data';
}

/** Checked ÷ (checked + waiting to link); null with no invoices at all (never a fake 100%). */
export function completenessOf(invoiceCount: number, pendingLinkCount: number): number | null {
  const all = invoiceCount + pendingLinkCount;
  return all > 0 ? invoiceCount / all : null;
}

/** The per-branch numbers the matrix adds next to the snapshot (all from existing readers). */
export interface MatrixExtras {
  /** ₪ awaiting a decision (approvals.queueSummary, owner lens: the whole branch queue). */
  awaitingIls: number;
  awaitingCount: number;
  /** Open credit requests ₪ (recovery outstanding); null when the branch has `recovery` off. */
  openCreditIls: number | null;
  /** ₪ actually back (recovery `recovered`); null when the branch has `recovery` off. */
  recoveredIls: number | null;
}

export type MatrixInput =
  | { ok: true; snapshot: BranchSnapshot; extras: MatrixExtras }
  | { ok: false; restaurantId: string; name: string };

export interface MatrixBranchOk {
  status: 'ok';
  restaurantId: string;
  name: string;
  isActive: boolean;
  state: MatrixCellState;
  /** 1 = the most leak ₪ among the OK branches. */
  rank: number;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  leakDeltaIls: number | null;
  thinBase: boolean;
  caughtBeforePaymentIls: number;
  claimedIls: number;
  awaitingIls: number;
  awaitingCount: number;
  openCreditIls: number | null;
  recoveredIls: number | null;
  invoiceCount: number;
  pendingLinkCount: number;
  completeness: number | null;
  /** Sparkline / heatmap, oldest → newest. */
  trend: BranchMonthPoint[];
}

export interface MatrixBranchError {
  status: 'error';
  restaurantId: string;
  name: string;
  isActive: boolean;
}

export type MatrixBranch = MatrixBranchOk | MatrixBranchError;

export interface MatrixTotals extends ChainTotals {
  awaitingIls: number;
  awaitingCount: number;
  /** null when no OK branch has `recovery` on. */
  openCreditIls: number | null;
  recoveredIls: number | null;
  invoiceCount: number;
  pendingLinkCount: number;
  completeness: number | null;
  /** At least one branch failed: the total covers the OK branches only. */
  partial: boolean;
}

export interface ChainMatrix {
  periodStart: string | null;
  periodEnd: string | null;
  /** Oldest → newest. */
  months: string[];
  totals: MatrixTotals;
  branches: MatrixBranch[];
  worstBranchId: string | null;
}

const toAg = (v: number): number => Math.round(v * 100);

/**
 * Pure: the matrix from per-branch results the caller computed under each
 * branch's RLS. The ₪ total row IS `aggregateChain` over the OK snapshots (the
 * same sum as chain.overview and its KPIs); the added columns are summed in
 * integer agorot. Rows keep `inputs` order (the caller sorts by name).
 */
export function buildMatrix(inputs: MatrixInput[], activeRestaurantId: string): ChainMatrix {
  const oks = inputs.filter((i): i is Extract<MatrixInput, { ok: true }> => i.ok);
  const agg = aggregateChain(oks.map((o) => o.snapshot), { topSuppliers: 0 });
  const rowById = new Map(agg.branches.map((b) => [b.restaurantId, b]));
  let awaiting = 0;
  let awaitingCount = 0;
  let open: number | null = null;
  let recovered: number | null = null;
  let invoiceCount = 0;
  let pendingLinkCount = 0;
  const branches: MatrixBranch[] = inputs.map((i) => {
    const restaurantId = i.ok ? i.snapshot.restaurantId : i.restaurantId;
    const isActive = restaurantId === activeRestaurantId;
    if (!i.ok) return { status: 'error', restaurantId, name: i.name, isActive };
    const row = rowById.get(restaurantId)!;
    const x = i.extras;
    awaiting += toAg(x.awaitingIls);
    awaitingCount += x.awaitingCount;
    if (x.openCreditIls !== null) open = (open ?? 0) + toAg(x.openCreditIls);
    if (x.recoveredIls !== null) recovered = (recovered ?? 0) + toAg(x.recoveredIls);
    invoiceCount += row.invoiceCount;
    pendingLinkCount += row.pendingLinkCount;
    return {
      status: 'ok',
      restaurantId,
      name: row.name,
      isActive,
      state: matrixCellState(row),
      rank: row.rank,
      leakIls: row.leakIls,
      spendIls: row.spendIls,
      leakPct: row.leakPct,
      leakDeltaIls: row.leakDeltaIls,
      thinBase: row.thinBase,
      caughtBeforePaymentIls: row.caughtBeforePaymentIls,
      claimedIls: row.claimedIls,
      awaitingIls: x.awaitingIls,
      awaitingCount: x.awaitingCount,
      openCreditIls: x.openCreditIls,
      recoveredIls: x.recoveredIls,
      invoiceCount: row.invoiceCount,
      pendingLinkCount: row.pendingLinkCount,
      completeness: completenessOf(row.invoiceCount, row.pendingLinkCount),
      trend: row.trend,
    };
  });
  return {
    periodStart: agg.periodStart,
    periodEnd: agg.periodEnd,
    months: agg.months,
    totals: {
      ...agg.totals,
      awaitingIls: awaiting / 100,
      awaitingCount,
      openCreditIls: open === null ? null : open / 100,
      recoveredIls: recovered === null ? null : recovered / 100,
      invoiceCount,
      pendingLinkCount,
      completeness: completenessOf(invoiceCount, pendingLinkCount),
      partial: oks.length < inputs.length,
    },
    branches,
    worstBranchId: agg.worstBranchId,
  };
}

/** Per-branch extras, inside that branch's own `inBranch` transaction. */
async function matrixExtras(tx: Database, restaurantId: string): Promise<MatrixExtras> {
  // Owner lens: the whole branch queue, the same rows and ₪ as the approvals tile.
  const queue = await computeQueueSummary(tx, restaurantId, 'owner');
  const recoveryOn = await isFeatureOn(tx, restaurantId, 'recovery');
  // Read-only: listClaims never materialises claims (the recovery screen's syncClaims does).
  const rec = recoveryOn ? await computeRecoverySummary(tx, restaurantId) : null;
  return {
    awaitingIls: queue.toDecide.amountIls,
    awaitingCount: queue.toDecide.count,
    openCreditIls: rec ? rec.outstandingAgorot / 100 : null,
    recoveredIls: rec ? rec.recoveredAgorot / 100 : null,
  };
}

const ScopeInput = z.string().max(64).optional();

/* ── W3-01b · the "סניף" column: approvals and pay run per branch ─────────── */

export const BY_BRANCH_KINDS = ['approvals', 'payRun'] as const;
export type ByBranchKind = (typeof BY_BRANCH_KINDS)[number];

export interface BranchApprovals {
  count: number;
  blockers: number;
  toDecideCount: number;
  toDecideIls: number;
}
export interface BranchPayRun {
  /** The branch has the pay run off: no numbers (never a fake ₪0). */
  enabled: boolean;
  invoices: number;
  payIls: number;
  holdIls: number;
  claimIls: number;
  creditIls: number;
  linkIls: number;
}

export type ByBranchRow =
  | { status: 'ok'; restaurantId: string; name: string; isActive: boolean; approvals: BranchApprovals | null; payRun: BranchPayRun | null }
  | { status: 'error'; restaurantId: string; name: string; isActive: boolean };

export interface ByBranchTotals {
  approvals: BranchApprovals | null;
  payRun: Omit<BranchPayRun, 'enabled'> | null;
  partial: boolean;
}

/** Pure: Σ of the OK rows in integer agorot (counts as integers). */
export function byBranchTotals(rows: ByBranchRow[], kind: ByBranchKind): ByBranchTotals {
  const oks = rows.filter((r): r is Extract<ByBranchRow, { status: 'ok' }> => r.status === 'ok');
  const partial = oks.length < rows.length;
  if (kind === 'approvals') {
    const a = { count: 0, blockers: 0, toDecideCount: 0, toDecideAg: 0 };
    for (const r of oks) {
      if (!r.approvals) continue;
      a.count += r.approvals.count;
      a.blockers += r.approvals.blockers;
      a.toDecideCount += r.approvals.toDecideCount;
      a.toDecideAg += toAg(r.approvals.toDecideIls);
    }
    return {
      approvals: { count: a.count, blockers: a.blockers, toDecideCount: a.toDecideCount, toDecideIls: a.toDecideAg / 100 },
      payRun: null,
      partial,
    };
  }
  const on = oks.filter((r) => r.payRun?.enabled);
  if (on.length === 0) return { approvals: null, payRun: null, partial };
  const t = { invoices: 0, pay: 0, hold: 0, claim: 0, credit: 0, link: 0 };
  for (const r of on) {
    const p = r.payRun!;
    t.invoices += p.invoices;
    t.pay += toAg(p.payIls);
    t.hold += toAg(p.holdIls);
    t.claim += toAg(p.claimIls);
    t.credit += toAg(p.creditIls);
    t.link += toAg(p.linkIls);
  }
  return {
    approvals: null,
    payRun: {
      invoices: t.invoices,
      payIls: t.pay / 100,
      holdIls: t.hold / 100,
      claimIls: t.claim / 100,
      creditIls: t.credit / 100,
      linkIls: t.link / 100,
    },
    partial,
  };
}


export const chainRouter = router({
  /**
   * W3-01 roll-up matrix: one row per branch in the requested scope, each
   * computed in its own `inBranch` (RLS) with the existing readers; a branch
   * that throws becomes an error row, never a failed page. Owner or bookkeeper
   * (read-only); same plan gate as `overview`.
   */
  matrix: authedProcedure
    .input(
      z
        .object({
          view: ChainViewInput.optional(),
          compare: z.enum(VIEW_COMPARES).default('off'),
          scope: ScopeInput,
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<ChainMatrix & { scope: BranchScope; lens: UserRole; truncated: boolean; compare: string; pool: ChainBranch[] }> => {
      const rows = await myMembershipRows(ctx.db, ctx.session.userId);
      const scope = parseBranchScope(input?.scope);
      const ms = resolveMatrixScope(rows, ctx.session.restaurantId, scope);
      const gate = await gateFor(ctx, { active: ms.active, branches: ms.pool });
      if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);

      const spec = input?.view ?? { period: 'this_month' as const };
      const compare = input?.compare ?? 'off';
      const branches = ms.branches.slice(0, MAX_CHAIN_BRANCHES);
      const results = await mapLimit(branches, BRANCH_CONCURRENCY, async (b): Promise<MatrixInput> => {
        try {
          return await inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx) => {
            const snapshot = await computeBranchSnapshot(tx, b.restaurantId, b.name, { spec, compare, trendMonths: 6 });
            return { ok: true as const, snapshot, extras: await matrixExtras(tx, b.restaurantId) };
          });
        } catch (err) {
          console.error('[chain.matrix] branch failed', b.restaurantId, err instanceof Error ? err.message : 'unknown');
          return { ok: false, restaurantId: b.restaurantId, name: b.name };
        }
      });
      return {
        ...buildMatrix(results, ms.active.restaurantId),
        scope,
        lens: ms.lens,
        truncated: ms.branches.length > MAX_CHAIN_BRANCHES,
        compare,
        pool: ms.pool.map((b) => ({ restaurantId: b.restaurantId, name: b.name, isActive: b.restaurantId === ms.active.restaurantId })),
      };
    }),

  /**
   * The 520 px branch peek: one branch's top suppliers and biggest invoices of
   * the period, after the same membership check as the matrix.
   */
  branchPeek: authedProcedure
    .input(z.object({ restaurantId: z.string().uuid(), view: ChainViewInput.optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await myMembershipRows(ctx.db, ctx.session.userId);
      const ms = resolveMatrixScope(rows, ctx.session.restaurantId, { kind: 'branch', restaurantId: input.restaurantId.toLowerCase() });
      const gate = await gateFor(ctx, { active: ms.active, branches: ms.pool });
      if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);
      const b = ms.branches[0]!;
      const spec = input.view ?? { period: 'this_month' as const };
      return inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx) => {
        const snapshot = await computeBranchSnapshot(tx, b.restaurantId, b.name, { spec, trendMonths: 1 });
        const invoices = await computeLeakBreakdown(tx, b.restaurantId, { view: spec, limit: 3 });
        return {
          restaurantId: b.restaurantId,
          name: b.name,
          state: matrixCellState(snapshot),
          leakIls: snapshot.leakIls,
          spendIls: snapshot.spendIls,
          leakPct: snapshot.leakPct,
          topSuppliers: [...snapshot.suppliers]
            .filter((s) => s.leakIls > 0)
            .sort((x, y) => y.leakIls - x.leakIls)
            .slice(0, 5),
          biggestInvoices: invoices
            .filter((i) => i.leakIls > 0)
            .map((i) => ({
              invoiceId: i.invoiceId,
              invoiceNumber: i.invoiceNumber,
              invoiceDate: i.invoiceDate,
              supplierName: i.supplierName,
              supplierNameEn: i.supplierNameEn,
              leakIls: i.leakIls,
            })),
        };
      });
    }),

  /**
   * W3-01b: the "סניף" column for approvals and the pay run. One row per branch
   * in the scope, each read in its own `inBranch` (RLS) with the same function
   * the single-branch screen uses (computeQueueSummary with the caller's own
   * lens / computePayRunMonth), so a branch row equals that branch's own screen.
   * Read-only; owner or bookkeeper; writes stay in each row's own restaurant.
   */
  byBranch: authedProcedure
    .input(
      z.object({
        kind: z.enum(BY_BRANCH_KINDS),
        scope: ScopeInput,
        monthOffset: z.union([z.literal(0), z.literal(-1)]).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await myMembershipRows(ctx.db, ctx.session.userId);
      const scope = parseBranchScope(input.scope);
      const ms = resolveMatrixScope(rows, ctx.session.restaurantId, scope);
      const gate = await gateFor(ctx, { active: ms.active, branches: ms.pool });
      if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);
      const branches = ms.branches.slice(0, MAX_CHAIN_BRANCHES);
      const out = await mapLimit(branches, BRANCH_CONCURRENCY, async (b): Promise<ByBranchRow> => {
        const base = { restaurantId: b.restaurantId, name: b.name, isActive: b.restaurantId === ms.active.restaurantId };
        try {
          return await inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx): Promise<ByBranchRow> => {
            if (input.kind === 'approvals') {
              const q = await computeQueueSummary(tx, b.restaurantId, ms.lens);
              return {
                status: 'ok',
                ...base,
                approvals: { count: q.count, blockers: q.blockers, toDecideCount: q.toDecide.count, toDecideIls: q.toDecide.amountIls },
                payRun: null,
              };
            }
            const p = await computePayRunMonth(tx, b.restaurantId, input.monthOffset, ms.lens);
            return {
              status: 'ok',
              ...base,
              approvals: null,
              payRun: {
                enabled: p.enabled,
                invoices: p.totals.invoices,
                payIls: p.totals.payIls,
                holdIls: p.totals.holdIls,
                claimIls: p.totals.claimIls,
                creditIls: p.totals.creditIls,
                linkIls: p.totals.linkIls,
              },
            };
          });
        } catch (err) {
          console.error('[chain.byBranch] branch failed', b.restaurantId, err instanceof Error ? err.message : 'unknown');
          return { status: 'error', ...base };
        }
      });
      return { kind: input.kind, scope, lens: ms.lens, rows: out, totals: byBranchTotals(out, input.kind) };
    }),

  /** The owner's branches on this billing account + what the plan allows. */
  branches: authedProcedure.query(async ({ ctx }): Promise<ChainBranchesResult> => {
    const scope = await resolveScope(ctx);
    const gate = await gateFor(ctx, scope);
    return {
      activeRestaurantId: scope.active.restaurantId,
      branches: scope.branches.map((b) => ({
        restaurantId: b.restaurantId,
        name: b.name,
        isActive: b.restaurantId === scope.active.restaurantId,
      })),
      planKey: gate.entitlements.planKey,
      hasBillingAccount: gate.entitlements.billingAccountId !== null,
      chainEnabled: gate.chainEnabled,
      branchLimit: gate.branchLimit,
      canAddBranch: gate.canAddBranch,
      isBillingOwner: gate.isBillingOwner,
    };
  }),

  /** The chain dashboard: per-branch numbers computed under each branch's RLS. */
  overview: authedProcedure
    .input(
      z
        .object({
          view: ChainViewInput.optional(),
          compare: z.enum(VIEW_COMPARES).default('off'),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<ChainOverviewResult> => {
      const scope = await resolveScope(ctx);
      const gate = await gateFor(ctx, scope);
      if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);

      const spec = input?.view ?? { period: 'this_month' as const };
      const compare = input?.compare ?? 'off';
      // The active branch always makes the cut; the rest alphabetically.
      const branches = [
        scope.active,
        ...scope.branches.filter((b) => b.restaurantId !== scope.active.restaurantId),
      ].slice(0, MAX_CHAIN_BRANCHES);
      const perBranch = await mapLimit(branches, BRANCH_CONCURRENCY, (b) =>
        inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx) => {
          const snapshot = await computeBranchSnapshot(tx, b.restaurantId, b.name, { spec, compare, trendMonths: 6 });
          // The disparity panel follows the selected period (the branch's own bounds).
          const prices = gate.priceDisparity
            ? await computeBranchPriceLines(tx, b.restaurantId, b.name, {
                monthStart: snapshot.periodStart,
                monthEnd: snapshot.periodEnd,
              })
            : null;
          return { snapshot, prices };
        }),
      );
      const priceLines = perBranch.flatMap((p) => (p.prices ? [p.prices] : []));
      return {
        ...aggregateChain(perBranch.map((p) => p.snapshot)),
        activeRestaurantId: scope.active.restaurantId,
        truncated: scope.branches.length > MAX_CHAIN_BRANCHES,
        compare,
        priceDisparities: gate.priceDisparity ? computePriceDisparities(priceLines, { limit: 10 }) : null,
      };
    }),

  /**
   * chainAlerts (flag): "the branch to look at this week" + each branch's main
   * leak driver (discrepancy type + ₪), last 7 local days. Existing charts SQL
   * only (computeLeakSummary / computeLeakGrouped by type), per branch under its
   * own RLS — same scope and plan gate as `overview`.
   */
  alerts: authedProcedure.query(async ({ ctx }): Promise<ChainAlertsResult> => {
    const scope = await resolveScope(ctx);
    const gate = await gateFor(ctx, scope);
    if (!gate.chainEnabled) throw chainRequired(gate.entitlements.planKey);
    if (!gate.chainAlerts) return { enabled: false, from: null, to: null, focus: null, branches: [] };

    const { from, to } = alertWeek(new Date());
    const spec = { period: 'custom' as const, from, to };
    const branches = [
      scope.active,
      ...scope.branches.filter((b) => b.restaurantId !== scope.active.restaurantId),
    ].slice(0, MAX_CHAIN_BRANCHES);
    const rows = await mapLimit(branches, BRANCH_CONCURRENCY, (b) =>
      inBranch(ctx.db, ctx.session.userId, b.restaurantId, async (tx): Promise<ChainAlertBranch> => {
        const summary = await computeLeakSummary(tx, b.restaurantId, spec);
        const byType = await computeLeakGrouped(tx, b.restaurantId, spec, 'type', 'off', 1);
        const top = byType.find((r) => r.key && r.leakIls > 0);
        return {
          restaurantId: b.restaurantId,
          name: b.name,
          leakIls: summary.leakIls,
          spendIls: summary.spendIls,
          leakPct: summary.leakPct,
          topDriver: top && summary.leakIls > 0 ? { type: top.key, leakIls: top.leakIls, count: top.count } : null,
        };
      }),
    );
    return { enabled: true, from, to, ...pickAlertFocus(rows) };
  }),

  /**
   * Validate a branch switch: the target must be one of the caller's own
   * memberships (any role). The web then refreshes the session JWT, whose
   * callback re-checks the same rule on the auth connection.
   */
  switchTarget: authedProcedure
    .input(z.object({ restaurantId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await myMembershipRows(ctx.db, ctx.session.userId);
      const target = rows.find((r) => r.restaurantId === input.restaurantId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'branch not found' });
      return { restaurantId: target.restaurantId, name: target.name, role: target.role };
    }),

  /** Rename one of the caller's owner branches on this chain. */
  renameBranch: authedProcedure
    .input(z.object({ restaurantId: z.string().uuid(), name: BRANCH_NAME }))
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx);
      const target = scope.branches.find((b) => b.restaurantId === input.restaurantId);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'branch not found' });
      await inBranch(ctx.db, ctx.session.userId, target.restaurantId, async (tx) => {
        await tx
          .update(restaurants)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(restaurants.id, target.restaurantId));
        await recordAudit(tx, {
          restaurantId: target.restaurantId,
          userId: ctx.session.userId,
          action: 'chain.branch_renamed',
          entityType: 'restaurant',
          entityId: target.restaurantId,
          before: { name: target.name },
          after: { name: input.name },
        });
      });
      return { restaurantId: target.restaurantId, name: input.name };
    }),

  /**
   * Open a new branch on the active branch's billing account, with the caller
   * as its owner — optionally copying suppliers, the catalog and the
   * tolerance/approval settings from the active branch.
   */
  addBranch: authedProcedure
    .input(
      z.object({
        name: BRANCH_NAME,
        copySuppliers: z.boolean().default(false),
        copyCatalog: z.boolean().default(false),
        copySettings: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveScope(ctx);
      const gate = await gateFor(ctx, scope);
      // A co-owner on someone else's account is refused as such (a clear "only the
      // account payer" message), BEFORE the plan gate that would show an upsell.
      if (gate.entitlements.billingAccountId !== null && !gate.isBillingOwner) {
        throw new TRPCError({ code: 'FORBIDDEN', message: NOT_BILLING_OWNER });
      }
      if (!gate.canAddBranch) throw chainRequired(gate.entitlements.planKey);
      const billingAccountId = scope.active.billingAccountId;
      if (!billingAccountId) throw chainRequired(gate.entitlements.planKey);
      // Only the billing account's payer may open (= be billed for) a branch —
      // a co-owner of one restaurant on someone else's account may not.
      const [account] = await inBranch(ctx.db, ctx.session.userId, scope.active.restaurantId, (tx) =>
        tx
          .select({ ownerUserId: billingAccounts.ownerUserId })
          .from(billingAccounts)
          .where(eq(billingAccounts.id, billingAccountId))
          .limit(1),
      );
      if (!account || account.ownerUserId !== ctx.session.userId) {
        // Stable message (not an ENTITLEMENT_REQUIRED cause): the web shows "only the
        // account payer can add branches", not a plan upsell.
        throw new TRPCError({ code: 'FORBIDDEN', message: NOT_BILLING_OWNER });
      }

      const sourceId = scope.active.restaurantId;
      const userId = ctx.session.userId;
      const copyCatalog = input.copyCatalog;
      // Products point at their supplier: the catalog cannot travel without them.
      const copySuppliers = input.copySuppliers || copyCatalog;
      const newId = randomUUID();

      const setTenant = (tx: Database, rid: string) =>
        tx.execute(sql`select set_config('app.current_restaurant_id', ${rid}, true)`);

      const counts = await ctx.db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Database;
        await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);

        // 1) Read the source branch under ITS tenant scope.
        await setTenant(tx, sourceId);
        const [source] = await tx
          .select({
            vatRate: restaurants.vatRate,
            timezone: restaurants.timezone,
            settings: restaurants.settings,
            billingAccountId: restaurants.billingAccountId,
          })
          .from(restaurants)
          .where(eq(restaurants.id, sourceId))
          .limit(1);
        if (!source || source.billingAccountId !== billingAccountId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'source branch not found' });
        }
        // Serialize concurrent addBranch calls on this account, then re-check the
        // limit inside the transaction (every restaurant on the account the
        // caller is a member of, any role — the RLS-visible set).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'chain-add:' + billingAccountId}))`);
        const [{ n: onAccount } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(restaurants)
          .where(eq(restaurants.billingAccountId, billingAccountId));
        if (gate.branchLimit !== null && onAccount >= gate.branchLimit) {
          throw chainRequired(gate.entitlements.planKey);
        }
        const srcSuppliers = copySuppliers
          ? await tx
              .select()
              .from(suppliers)
              .where(and(eq(suppliers.restaurantId, sourceId), eq(suppliers.active, true)))
          : [];
        const srcProducts = copyCatalog
          ? await tx.select().from(products).where(eq(products.restaurantId, sourceId))
          : [];
        const srcItems = copyCatalog
          ? await tx
              .select()
              .from(supplierCatalogItems)
              .where(eq(supplierCatalogItems.restaurantId, sourceId))
          : [];

        // 2) Write the new branch under the NEW tenant scope.
        await setTenant(tx, newId);
        await tx.insert(restaurants).values({
          id: newId,
          name: input.name,
          billingAccountId,
          vatRate: source.vatRate,
          timezone: source.timezone,
          settings: input.copySettings ? source.settings : {},
        });
        await tx.insert(memberships).values({ userId, restaurantId: newId, role: 'owner' });
        await tx.insert(storageNamespaces).values({
          restaurantId: newId,
          bucket: 'invoice-scans',
          prefix: `${newId}/`,
        });

        const supplierMap = new Map<string, string>();
        if (srcSuppliers.length) {
          await tx.insert(suppliers).values(
            srcSuppliers.map((s) => {
              const id = randomUUID();
              supplierMap.set(s.id, id);
              return {
                id,
                restaurantId: newId,
                name: s.name,
                nameEn: s.nameEn,
                businessId: s.businessId,
                contactEmail: s.contactEmail,
                contactWhatsapp: s.contactWhatsapp,
                paymentTerms: s.paymentTerms,
                vatRate: s.vatRate,
                deliverySchedule: s.deliverySchedule,
                orderSchedule: s.orderSchedule,
                // Platform links (externalRef / sourcePlatform) are per-branch
                // integrations — never copied.
              };
            }),
          );
        }
        const productMap = new Map<string, string>();
        const productRows = srcProducts.filter((p) => !p.supplierId || supplierMap.has(p.supplierId));
        if (productRows.length) {
          await tx.insert(products).values(
            productRows.map((p) => {
              const id = randomUUID();
              productMap.set(p.id, id);
              return {
                id,
                restaurantId: newId,
                supplierId: p.supplierId ? supplierMap.get(p.supplierId)! : null,
                canonicalName: p.canonicalName,
                nameEn: p.nameEn,
                category: p.category,
                defaultUnit: p.defaultUnit,
                barcodeEan: p.barcodeEan,
                embedding: p.embedding,
              };
            }),
          );
        }
        const itemRows = srcItems.filter((i) => supplierMap.has(i.supplierId));
        if (itemRows.length) {
          await tx.insert(supplierCatalogItems).values(
            itemRows.map((i) => ({
              restaurantId: newId,
              supplierId: supplierMap.get(i.supplierId)!,
              productId: i.productId ? (productMap.get(i.productId) ?? null) : null,
              supplierSku: i.supplierSku,
              supplierNameRaw: i.supplierNameRaw,
              unit: i.unit,
              packSize: i.packSize,
              listPrice: i.listPrice,
              currency: i.currency,
              barcodeEan: i.barcodeEan,
              active: i.active,
              observedAt: i.observedAt,
            })),
          );
        }
        const result = {
          suppliers: supplierMap.size,
          products: productMap.size,
          catalogItems: itemRows.length,
        };
        await recordAudit(tx, {
          restaurantId: newId,
          userId,
          action: 'chain.branch_added',
          entityType: 'restaurant',
          entityId: newId,
          after: { name: input.name, copiedFrom: sourceId, settings: input.copySettings, ...result },
        });
        return result;
      });

      return { restaurantId: newId, name: input.name, copied: counts };
    }),
});
