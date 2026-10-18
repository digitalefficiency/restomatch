import {
  and,
  count,
  desc,
  discrepancies,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  lte,
  matchRuns,
  sql,
  type Database,
} from '@restomatch/db';

export interface OwnerKpis {
  monthPotentialLossIls: number;
  monthSavingsCapturedIls: number;
  pendingApprovalsCount: number;
  /** null = no match runs in the last 7 days (nothing to judge — never a fake 100%). */
  weekCleanMatchPct: number | null;
}

export function emptyKpis(): OwnerKpis {
  return {
    monthPotentialLossIls: 0,
    monthSavingsCapturedIls: 0,
    pendingApprovalsCount: 0,
    weekCleanMatchPct: null,
  };
}

/**
 * Excludes the QTY_SHORT that the engine zeroes when the invoice bills the
 * missing units: the money sits on its QTY_OVER sibling, so the ₪0 twin is not
 * a decision for anyone (approvals queue, pending count).
 */
export function notZeroShortTwin() {
  return sql`not (${discrepancies.type} = 'QTY_SHORT' and ${discrepancies.deltaAmount} = 0)`;
}

export interface ComputeOwnerKpisOptions {
  /** Override "now" — used in tests. */
  now?: Date;
}

/**
 * Compute the four headline KPIs for the owner dashboard:
 *
 *  • monthPotentialLossIls — sum of unresolved discrepancy delta amounts
 *    (warn+block severity) in the current month.
 *  • monthSavingsCapturedIls — sum of resolved discrepancy delta amounts
 *    (resolved or accepted) in the current month.
 *  • pendingApprovalsCount — discrepancies awaiting decision (open or escalated).
 *  • weekCleanMatchPct — % of match_runs in the last 7 days whose
 *    overall_status was 'clean'. null if no runs yet (NUM-10: an empty
 *    week used to report a misleading 100%).
 */
export async function computeOwnerKpis(
  db: Database,
  restaurantId: string,
  options: ComputeOwnerKpisOptions = {},
): Promise<OwnerKpis> {
  const now = options.now ?? new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Potential loss this month — unresolved warn/block discrepancies
  const potentialLoss = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${discrepancies.deltaAmount}), 0)`.as('sum'),
    })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        inArray(discrepancies.severity, ['warn', 'block']),
        inArray(discrepancies.resolutionStatus, ['open', 'escalated']),
        gte(discrepancies.createdAt, startOfMonth),
      ),
    );

  // 2. Savings captured — resolved/accepted discrepancies this month
  const savings = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${discrepancies.deltaAmount}), 0)`.as('sum'),
    })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        inArray(discrepancies.resolutionStatus, ['accepted', 'resolved']),
        gte(discrepancies.createdAt, startOfMonth),
      ),
    );

  // 3. Pending approvals — open or escalated, any severity above info, minus
  //    the ₪0 QTY_SHORT twin of a short delivery billed in full (nothing to decide).
  const pending = await db
    .select({ c: count(discrepancies.id) })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        inArray(discrepancies.severity, ['warn', 'block']),
        inArray(discrepancies.resolutionStatus, ['open', 'escalated']),
        notZeroShortTwin(),
      ),
    );

  // 4. Clean match % in the last 7 days
  const weekRuns = await db
    .select({
      total: count(matchRuns.id),
      clean: sql<string>`SUM(CASE WHEN ${matchRuns.overallStatus} = 'clean' THEN 1 ELSE 0 END)`.as(
        'clean',
      ),
    })
    .from(matchRuns)
    .where(
      and(
        eq(matchRuns.restaurantId, restaurantId),
        gte(matchRuns.runAt, sevenDaysAgo),
      ),
    );

  const total = Number(weekRuns[0]?.total ?? 0);
  const cleanCount = Number(weekRuns[0]?.clean ?? 0);
  const weekCleanMatchPct = total === 0 ? null : Math.round((cleanCount / total) * 1000) / 10;

  return {
    monthPotentialLossIls: Number(potentialLoss[0]?.sum ?? 0),
    monthSavingsCapturedIls: Number(savings[0]?.sum ?? 0),
    pendingApprovalsCount: Number(pending[0]?.c ?? 0),
    weekCleanMatchPct,
  };
}

/* unused-import guard: keep imports stable across reorders */
void desc;
void invoices;
void isNull;
void lte;
