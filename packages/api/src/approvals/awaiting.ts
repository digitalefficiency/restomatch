/**
 * G-12a — "awaiting decision" as ONE function.
 *
 * How many open gaps, and how much ₪, wait for a decision — and for whom. Every
 * reader (approvals queue tiles, home "Needs you", nav badge, end-of-day e-mail)
 * calls this instead of re-deriving it, so the figure can never read 4 on one
 * screen and 5 on another (deep-fix class 5).
 *
 *   awaitingDecision(db, ctx, { scope, filters? }): Promise<AwaitingDecision>
 *
 *  • `scope: 'mine'`  — the rows the caller decides: routed to a role the caller
 *    may act on (`canActOn`, routed rows only). For the owner this is today's
 *    `approvals.queueSummary` "mine" set, byte for byte.
 *  • `scope: 'all'`   — every open row the caller may READ (owner / manager /
 *    bookkeeper read all routings; receiver / chef read none). `byRole` then says
 *    who it waits on ("ממתין לבעלים · 4 · ₪296.00"), so a bookkeeper with an empty
 *    queue never reads "הכל טופל" while the owner still has items.
 *  • `filters` — the approvals queue filters (types, severities, supplierIds) plus
 *    invoiceIds. All optional.
 *
 * Rules (the reference is `routers/approvals.ts` queueSummary; W2-04 switches it here):
 *  • ALL open / escalated rows of the tenant, no limit and no cursor; the ₀ QTY_SHORT
 *    twin of a PRICE_HIGHER is dropped (`notZeroShortTwin`).
 *  • A row is "להחלטה" when `isClaimableRow` (₪ to claim), else "לבדיקה" (`reviewOnly`,
 *    counted, never ₪). `toDecide.count + reviewOnly.count = count`.
 *  • ₪ = the letters' rule: `claimableLines` over the per-invoice leak from
 *    `@restomatch/charts` (same LEAK_FILTER, same cap at the invoice total, same
 *    pending-link and paid rules), restricted to the scope's rows.
 *  • ₪ per VAT basis, never summed across bases: `excl` (line ₪ before VAT), `incl`
 *    (a duplicate invoice, incl. VAT), `vat` (a VAT amount). `mixedBasis` = more than
 *    one basis is non-zero.
 *  • `pendingLink` — invoices of the scope's rows still waiting for a PO link (they
 *    claim nothing yet): how many, and their totals incl. VAT.
 *  • Integer agorot inside; shekels at 2 dp out.
 *  • A role without `money.view` (receiver, chef — owner decision) gets every ₪ field
 *    `null`; counts stay.
 *
 * Known limit (same as queueSummary until W2-13): rows of a superseded match run that
 * were never decided still count.
 *
 * Interims (one line each to swap):
 *  • INTERIM(W2-09a): `invoicesLeak` loops `computeInvoiceLeak`; swap to the batch
 *    `computeInvoicesLeak(db, rid, ids)` (same Map shape, same values).
 *  • INTERIM(G-07): `canRead` / `canViewMoney` mirror G-07's `VISIBLE_TO` and
 *    `CAP['money.view']`; swap to `canSee(role, rr)` / `hasCap(role, 'money.view')`.
 */
import {
  and,
  discrepancies,
  discrepancyType,
  eq,
  inArray,
  invoices,
  matchRuns,
  severity as severityEnum,
  type Database,
  type UserRole,
} from '@restomatch/db';
import {
  computeInvoiceLeak,
  notZeroShortTwin,
  type LeakBreakdownInvoice,
} from '@restomatch/charts';
import { claimableLines, type VatBasis } from '../lib/claims';
import { canActOn } from '../lib/roles';
import { isClaimableRow } from '../routers/approvals';

export type AwaitingScope = 'mine' | 'all';

/** Who a row waits on: its routed role, or `'unrouted'` (owner / manager decide it). */
export type AwaitingRouting = UserRole | 'unrouted';

export interface AwaitingFilters {
  types?: ReadonlyArray<(typeof discrepancyType.enumValues)[number]>;
  severities?: ReadonlyArray<(typeof severityEnum.enumValues)[number]>;
  supplierIds?: ReadonlyArray<string>;
  invoiceIds?: ReadonlyArray<string>;
}

/** ₪ by VAT basis, shekels at 2 dp. Never add the three together. */
export interface IlsByBasis {
  excl: number;
  incl: number;
  vat: number;
  /** More than one basis is non-zero: show them apart, never as one sum. */
  mixedBasis: boolean;
}

export interface AwaitingDecision {
  scope: AwaitingScope;
  /** Open rows in scope (after filters). */
  count: number;
  /** Of which severity = block. */
  blockers: number;
  /** Oldest open row in scope. */
  oldestAt: Date | null;
  /** "להחלטה (₪)": rows with ₪ to claim (`isClaimableRow`). */
  toDecide: { count: number };
  /** "לבדיקה (ללא ₪)": info / non-claimable rows. Count only, never ₪. */
  reviewOnly: { count: number };
  /** The claimable ₪ of the `toDecide` rows. `null` without `money.view`. */
  ils: IlsByBasis | null;
  /** Invoices of the scope's rows still waiting for a PO link (no claim ₪ yet). */
  pendingLink: { count: number; inclVatIls: number | null };
  /** The same rows by who decides them. Non-empty routings only, fixed order. */
  byRole: Array<{ role: AwaitingRouting; count: number; ils: IlsByBasis | null }>;
}

export interface AwaitingContext {
  session: { restaurantId: string; role: UserRole };
}

const OPEN_STATUSES = ['open', 'escalated'] as const;
const ROUTING_ORDER: ReadonlyArray<AwaitingRouting> = [
  'owner',
  'manager',
  'bookkeeper',
  'receiver',
  'chef',
  'unrouted',
];

/** INTERIM(G-07): = `canSee(role, requiredRole)` (VISIBLE_TO). */
const READS_ALL: ReadonlyArray<UserRole> = ['owner', 'manager', 'bookkeeper'];
function canRead(role: UserRole, _requiredRole: UserRole | null): boolean {
  return READS_ALL.includes(role);
}
/** INTERIM(G-07): = `hasCap(role, 'money.view')`. */
function canViewMoney(role: UserRole): boolean {
  return READS_ALL.includes(role);
}

/** INTERIM(W2-09a): = `computeInvoicesLeak(db, restaurantId, ids)`. */
async function invoicesLeak(
  db: Database,
  restaurantId: string,
  ids: readonly string[],
): Promise<Map<string, LeakBreakdownInvoice>> {
  const out = new Map<string, LeakBreakdownInvoice>();
  for (const id of new Set(ids)) {
    const inv = await computeInvoiceLeak(db, restaurantId, id);
    if (inv) out.set(id, inv);
  }
  return out;
}

type Agorot = Record<VatBasis, number>;
const zero = (): Agorot => ({ excl: 0, incl: 0, vat: 0 });
const toIls = (a: Agorot): IlsByBasis => ({
  excl: a.excl / 100,
  incl: a.incl / 100,
  vat: a.vat / 100,
  mixedBasis: [a.excl, a.incl, a.vat].filter((v) => v !== 0).length > 1,
});

export async function awaitingDecision(
  db: Database,
  ctx: AwaitingContext,
  opts: { scope: AwaitingScope; filters?: AwaitingFilters },
): Promise<AwaitingDecision> {
  const rid = ctx.session.restaurantId;
  const role = ctx.session.role;
  const f = opts.filters;

  const all = await db
    .select({
      id: discrepancies.id,
      type: discrepancies.type,
      severity: discrepancies.severity,
      requiredRole: discrepancies.requiresRole,
      deltaAmount: discrepancies.deltaAmount,
      createdAt: discrepancies.createdAt,
      invoiceId: matchRuns.invoiceId,
    })
    .from(discrepancies)
    .innerJoin(
      matchRuns,
      and(eq(matchRuns.id, discrepancies.matchRunId), eq(matchRuns.restaurantId, rid)),
    )
    .leftJoin(invoices, and(eq(invoices.id, matchRuns.invoiceId), eq(invoices.restaurantId, rid)))
    .where(
      and(
        eq(discrepancies.restaurantId, rid),
        inArray(discrepancies.resolutionStatus, [...OPEN_STATUSES]),
        notZeroShortTwin(),
        f?.types?.length ? inArray(discrepancies.type, [...f.types]) : undefined,
        f?.severities?.length ? inArray(discrepancies.severity, [...f.severities]) : undefined,
        f?.supplierIds?.length ? inArray(invoices.supplierId, [...f.supplierIds]) : undefined,
        f?.invoiceIds?.length ? inArray(matchRuns.invoiceId, [...f.invoiceIds]) : undefined,
      ),
    );

  const rows =
    opts.scope === 'mine'
      ? all.filter((r) => r.requiredRole !== null && canActOn(role, r.requiredRole))
      : all.filter((r) => canRead(role, r.requiredRole));

  const money = canViewMoney(role);
  const decide = rows.filter(isClaimableRow);

  // Per-invoice leak once for every invoice in scope, then the letters' rule.
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((v): v is string => !!v))];
  const leaks = invoiceIds.length
    ? await invoicesLeak(db, rid, invoiceIds)
    : new Map<string, LeakBreakdownInvoice>();
  const claimAgorot = new Map<string, { agorot: number; basis: VatBasis }>();
  for (const inv of leaks.values()) {
    for (const c of claimableLines(inv)) {
      claimAgorot.set(c.line.discrepancyId, { agorot: Math.round(c.amount * 100), basis: c.basis });
    }
  }

  const total = zero();
  const perRole = new Map<AwaitingRouting, { count: number; agorot: Agorot }>();
  for (const r of rows) {
    const key: AwaitingRouting = r.requiredRole ?? 'unrouted';
    const e = perRole.get(key) ?? { count: 0, agorot: zero() };
    e.count += 1;
    const c = isClaimableRow(r) ? claimAgorot.get(r.id) : undefined;
    if (c) {
      e.agorot[c.basis] += c.agorot;
      total[c.basis] += c.agorot;
    }
    perRole.set(key, e);
  }

  let pendingCount = 0;
  let pendingAgorot = 0;
  for (const id of invoiceIds) {
    const inv = leaks.get(id);
    if (!inv?.pendingLink) continue;
    pendingCount += 1;
    pendingAgorot += Math.round(inv.totalInclVat * 100);
  }

  const oldest = rows.reduce<Date | null>(
    (o, r) => (!o || r.createdAt < o ? r.createdAt : o),
    null,
  );
  return {
    scope: opts.scope,
    count: rows.length,
    blockers: rows.filter((r) => r.severity === 'block').length,
    oldestAt: oldest,
    toDecide: { count: decide.length },
    reviewOnly: { count: rows.length - decide.length },
    ils: money ? toIls(total) : null,
    pendingLink: { count: pendingCount, inclVatIls: money ? pendingAgorot / 100 : null },
    byRole: ROUTING_ORDER.filter((k) => perRole.has(k)).map((k) => {
      const e = perRole.get(k)!;
      return { role: k, count: e.count, ils: money ? toIls(e.agorot) : null };
    }),
  };
}
