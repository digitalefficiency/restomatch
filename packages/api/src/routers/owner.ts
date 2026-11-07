import {
  computeLeakGrouped,
  computeLeakSummary,
  computeLeakTrend,
  computeViewOptions,
  LEAK_SEVERITIES,
  RESOLUTION_STATUSES,
  VIEW_COMPARES,
  VIEW_GROUPS,
  VIEW_PERIODS,
  type LeakGroupRow,
  type LeakTrendPoint,
  type ViewSpec,
  computeLeakBreakdown,
  computeLeakComparison,
  computeLeakDrivers,
  computeLeakReport,
  DRIVER_DIMENSIONS,
  type LeakComparison,
  type LeakDrivers,
  computeLeakHero,
  computeLeaks,
  computeOwnerKpis,
  computeSupplierScorecards,
  type LeakBreakdownInvoice,
  type LeakHero,
  type LeakReport,
  type LeakRow,
  type OwnerKpis,
  type SupplierScorecard,
} from '@restomatch/charts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { discrepancyType, eq, restaurants, sql } from '@restomatch/db';
import { invoiceEvidence, type LineEvidence } from '../leaks/evidence';
import { buildLeakReportExport, type LeakReportExport } from '../leaks/reportExport';
import { appError } from '../errors';
import { featureEnabled } from '../lib/features';
import { vatAtRisk, type VatAtRiskResult } from '../vat/vatAtRisk';
import {
  financeProcedure,
  invoiceReaderProcedure,
  managerProcedure,
  memberProcedure,
  ownerProcedure,
  requireFeature,
  router,
} from '../trpc';

/** Deep analytics (leak detective, supplier scorecards) are a paid feature. */
const analyticsProcedure = ownerProcedure.use(requireFeature('advanced_analytics'));
const memberAnalyticsProcedure = memberProcedure.use(requireFeature('advanced_analytics'));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day in a sane range (rejects 2026-02-30, 0000-01-01 — Postgres would throw). */
const realDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  const y = Number(s.slice(0, 4));
  return y >= 2000 && y <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const FINANCE_ROLES: ReadonlyArray<string> = ['owner', 'manager', 'bookkeeper'];

/**
 * A dashboard view: period (+ custom range) and filters. Every value is
 * enumerated or shape-checked here and bound as a SQL parameter downstream.
 */
/** owner.kpis as served: money fields are null for roles that see no ₪. */
export type OwnerKpisView = Omit<OwnerKpis, 'monthPotentialLossIls' | 'monthSavingsCapturedIls'> & {
  monthPotentialLossIls: number | null;
  monthSavingsCapturedIls: number | null;
};

export function redactKpis(k: OwnerKpis, role: string): OwnerKpisView {
  if (FINANCE_ROLES.includes(role)) return k;
  return { ...k, monthPotentialLossIls: null, monthSavingsCapturedIls: null };
}

export type LeakBreakdownWithEvidence = Omit<LeakBreakdownInvoice, 'lines'> & {
  lines: Array<LeakBreakdownInvoice['lines'][number] & { evidence: LineEvidence }>;
};

export interface LineHistoryEntry {
  /** The audit action, e.g. 'discrepancy.approved'. */
  action: string;
  /** ISO instant; the UI shows dd.MM.yyyy HH:mm in Asia/Jerusalem. */
  at: string;
  userName: string | null;
  userRole: string | null;
  /** The resolution status before → after, when the audit row carries it. */
  before: string | null;
  after: string | null;
}

type DbRow = Record<string, unknown>;
const rowsOf = (res: unknown): DbRow[] => (Array.isArray(res) ? (res as DbRow[]) : ((res as { rows?: DbRow[] }).rows ?? []));
const roleOf = (v: unknown): string | null =>
  v && typeof v === 'object' && typeof (v as Record<string, unknown>).role === 'string' ? ((v as Record<string, unknown>).role as string) : null;
const statusOf = (v: unknown): string | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const s = o.resolutionStatus ?? o.resolution_status ?? o.status;
  return typeof s === 'string' ? s : null;
};

export const ViewInput = z
  .object({
    period: z.enum(VIEW_PERIODS).default('this_month'),
    from: z.string().regex(ISO_DATE).refine(realDate, 'not a calendar date').optional(),
    to: z.string().regex(ISO_DATE).refine(realDate, 'not a calendar date').optional(),
    filters: z
      .object({
        supplierIds: z.array(z.string().uuid()).max(50).optional(),
        categories: z.array(z.string().min(1).max(100)).max(50).optional(),
        types: z.array(z.enum(discrepancyType.enumValues)).max(12).optional(),
        severities: z.array(z.enum(LEAK_SEVERITIES)).max(2).optional(),
        statuses: z.array(z.enum(RESOLUTION_STATUSES)).max(5).optional(),
      })
      .optional(),
  })
  .refine((v) => v.period !== 'custom' || (!!v.from && !!v.to), {
    message: 'custom period needs from and to',
  })
  .refine((v) => !v.from || !v.to || Math.abs(Date.parse(v.to) - Date.parse(v.from)) <= 3 * 366 * 86_400_000, {
    message: 'custom range is limited to 3 years',
  });
type ViewInputT = z.infer<typeof ViewInput>;
const CompareInput = z.enum(VIEW_COMPARES).default('off');
const specOf = (v: ViewInputT): ViewSpec => ({ period: v.period, from: v.from, to: v.to, filters: v.filters });

export const ownerRouter = router({
  /**
   * VAT at risk (flag `vatAtRisk`): tax invoices above the allocation-number
   * threshold of their date with no valid allocation number — their input VAT
   * cannot be deducted. A separate figure: never part of the leak. Invoice
   * readers only (chef is excluded, like the invoice screens). `invoiceId`
   * narrows it to one invoice (the invoice page badge).
   */
  vatAtRisk: invoiceReaderProcedure
    .input(
      z
        .object({
          period: z.enum(['open', 'this_month', 'all']).default('open'),
          invoiceId: z.string().uuid().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }): Promise<VatAtRiskResult> => {
      const [r] = await ctx.db
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.session.restaurantId))
        .limit(1);
      if (!featureEnabled(r?.settings, 'vatAtRisk')) {
        throw appError('FORBIDDEN', 'FEATURE_DISABLED', 'הפיצ׳ר אינו פעיל עבור המסעדה');
      }
      return vatAtRisk(ctx.db, ctx.session.restaurantId, input.period, { invoiceId: input.invoiceId });
    }),

  // KPIs stay on the core plan — the dashboard headline numbers are table stakes.
  // Money fields go only to the roles that decide on money (owner decision: receiver
  // and chef see no purchase or leak ₪); the others get the counts and null — never
  // ₪0, which would read as "nothing leaked". TODO(G-07): swap FINANCE_ROLES for the
  // `money.view` capability in one line once it merges.
  kpis: memberProcedure.query(async ({ ctx }): Promise<OwnerKpisView> => {
    const k = await computeOwnerKpis(ctx.db, ctx.session.restaurantId);
    return redactKpis(k, ctx.session.role);
  }),

  // The leak hero ("₪X leaked this month, Y% of spend, Z caught before payment")
  // and its drill-down are core-plan, like the KPIs: they ARE the product.
  leakHero: memberProcedure
    .input(z.object({ monthOffset: z.number().int().min(-24).max(0).optional() }).optional())
    .query(async ({ ctx, input }): Promise<LeakHero> => {
      return computeLeakHero(ctx.db, ctx.session.restaurantId, { monthOffset: input?.monthOffset });
    }),

  // Invoice-level drill-down (supplier, invoice number, line deltas) — the same
  // roles as /dashboard/leaks; a receiver/chef sees only the aggregate hero.
  leakBreakdown: financeProcedure
    .input(
      z
        .object({
          monthOffset: z.number().int().min(-24).max(0).optional(),
          limit: z.number().int().positive().max(200).optional(),
          // Optional view (period + filters) — replaces monthOffset when given.
          view: ViewInput.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<LeakBreakdownWithEvidence[]> => {
      const rows = await computeLeakBreakdown(ctx.db, ctx.session.restaurantId, {
        monthOffset: input?.monthOffset,
        limit: input?.limit,
        view: input?.view ? specOf(input.view) : undefined,
      });
      // W2-09c: each line carries its verified basis (additive; the ₪ fields are unchanged).
      return rows.map((inv) => {
        const ev = invoiceEvidence(inv);
        return { ...inv, lines: inv.lines.map((l, i) => ({ ...l, evidence: ev[i]! })) };
      });
    }),

  // W2-09c · the view's window vs the same span before it, with coverage per window.
  leakComparison: financeProcedure
    .input(z.object({ view: ViewInput }))
    .query(async ({ ctx, input }): Promise<LeakComparison> => {
      return computeLeakComparison(ctx.db, ctx.session.restaurantId, specOf(input.view));
    }),

  // W2-09c · what moved the leak: top contributors to the Δ + an "other" rest (Σ = Δ).
  leakDrivers: financeProcedure
    .input(
      z.object({
        view: ViewInput,
        by: z.enum(DRIVER_DIMENSIONS).default('supplier'),
        top: z.number().int().min(1).max(10).default(3),
      }),
    )
    .query(async ({ ctx, input }): Promise<LeakDrivers> => {
      return computeLeakDrivers(ctx.db, ctx.session.restaurantId, specOf(input.view), { by: input.by, top: input.top });
    }),

  // W2-09c · who did what to a breakdown line, newest first (the "היסטוריה" disclosure).
  // A discrepancy of another restaurant is NOT_FOUND, never an empty history.
  lineHistory: financeProcedure
    .input(z.object({ discrepancyId: z.string().uuid(), limit: z.number().int().min(1).max(20).default(3) }))
    .query(async ({ ctx, input }): Promise<LineHistoryEntry[]> => {
      const rid = ctx.session.restaurantId;
      const own = rowsOf(
        await ctx.db.execute(sql`SELECT 1 FROM discrepancies WHERE id = ${input.discrepancyId}::uuid AND restaurant_id = ${rid}`),
      );
      if (own.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'discrepancy not found' });
      const res = rowsOf(
        await ctx.db.execute(sql`
          SELECT a.action, a.at, a.before, a.after, u.name AS user_name, m.role AS user_role
          FROM audit_log a
          LEFT JOIN users u ON u.id = a.user_id
          LEFT JOIN memberships m ON m.user_id = a.user_id AND m.restaurant_id = ${rid}
          WHERE a.restaurant_id = ${rid} AND a.entity_type = 'discrepancy' AND a.entity_id = ${input.discrepancyId}::uuid
          ORDER BY a.at DESC
          LIMIT ${input.limit}
        `),
      );
      return res.map((r) => ({
        action: String(r.action),
        at: (r.at instanceof Date ? r.at : new Date(String(r.at))).toISOString(),
        userName: (r.user_name as string | null) ?? null,
        // The role at decision time (audit `after.role`), else today's membership.
        userRole: roleOf(r.after) ?? (r.user_role as string | null) ?? null,
        before: statusOf(r.before),
        after: statusOf(r.after),
      }));
    }),

  // ── Dashboard views (period / compare / group-by / filters) ──────────────
  // Summary = hero numbers for any view; member-level like the hero itself.
  leakSummary: memberProcedure
    .input(z.object({ view: ViewInput, compare: CompareInput }))
    .query(async ({ ctx, input }): Promise<{ current: LeakHero; previous: LeakHero | null }> => {
      // Any period is hero-level for every role, but filters slice the leak per
      // supplier / category / type — finance detail, like leakGrouped.
      const f = input.view.filters;
      const filtered = !!f && Object.values(f).some((v) => Array.isArray(v) && v.length > 0);
      if (filtered && !FINANCE_ROLES.includes(ctx.session.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'view filters are for owner/manager/bookkeeper' });
      }
      const spec = specOf(input.view);
      const rid = ctx.session.restaurantId;
      const [current, previous] = await Promise.all([
        computeLeakSummary(ctx.db, rid, spec),
        input.compare === 'off' ? Promise.resolve(null) : computeLeakSummary(ctx.db, rid, spec, input.compare),
      ]);
      return { current, previous };
    }),

  // Group-by breakdown and trend expose supplier/product detail → finance roles.
  leakGrouped: financeProcedure
    .input(z.object({ view: ViewInput, groupBy: z.enum(VIEW_GROUPS), compare: CompareInput }))
    .query(async ({ ctx, input }): Promise<{ rows: LeakGroupRow[]; previous: LeakGroupRow[] | null }> => {
      const spec = specOf(input.view);
      const rid = ctx.session.restaurantId;
      const [rows, previous] = await Promise.all([
        computeLeakGrouped(ctx.db, rid, spec, input.groupBy),
        input.compare === 'off'
          ? Promise.resolve(null)
          : computeLeakGrouped(ctx.db, rid, spec, input.groupBy, input.compare, 200),
      ]);
      return { rows, previous };
    }),

  leakTrend: financeProcedure
    .input(z.object({ view: ViewInput, compare: CompareInput }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        bucket: 'day' | 'month';
        points: LeakTrendPoint[];
        previous: LeakTrendPoint[] | null;
      }> => {
        const spec = specOf(input.view);
        const rid = ctx.session.restaurantId;
        const [cur, prev] = await Promise.all([
          computeLeakTrend(ctx.db, rid, spec),
          input.compare === 'off' ? Promise.resolve(null) : computeLeakTrend(ctx.db, rid, spec, input.compare),
        ]);
        return { bucket: cur.bucket, points: cur.points, previous: prev?.points ?? null };
      },
    ),

  // Filter choices (this restaurant's suppliers + product categories).
  viewOptions: financeProcedure.query(async ({ ctx }) => computeViewOptions(ctx.db, ctx.session.restaurantId)),

  // Print-ready monthly leak report — owner/manager only (it lists supplier
  // spend and what the team waived). Core plan, like the hero it expands.
  // W2-09c: finance tier — the bookkeeper reads everything (owner decision).
  leakReport: financeProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }))
    .query(async ({ ctx, input }): Promise<LeakReport> => {
      return computeLeakReport(ctx.db, ctx.session.restaurantId, input.month);
    }),

  // W2-09c · the same report as a 3-sheet XLSX + a CSV per sheet (totals = the rows shown).
  leakReportExport: financeProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), locale: z.enum(['he', 'en']).default('he') }))
    .query(async ({ ctx, input }): Promise<LeakReportExport> => {
      const report = await computeLeakReport(ctx.db, ctx.session.restaurantId, input.month);
      return buildLeakReportExport(report, input.locale);
    }),

  leaks: analyticsProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).optional(),
          minDeltaPct: z.number().nonnegative().max(2).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }): Promise<LeakRow[]> => {
      return computeLeaks(ctx.db, ctx.session.restaurantId, input ?? {});
    }),

  // NON-BREAKING pagination: still returns an array. Supplier scorecards have no
  // createdAt cursor, so we expose an optional `limit` and slice the (already
  // restaurant-scoped, name-ordered) result instead.
  suppliers: memberAnalyticsProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).optional() }).optional())
    .query(async ({ ctx, input }): Promise<SupplierScorecard[]> => {
      const cards = await computeSupplierScorecards(ctx.db, ctx.session.restaurantId);
      return input?.limit ? cards.slice(0, input.limit) : cards;
    }),
});
