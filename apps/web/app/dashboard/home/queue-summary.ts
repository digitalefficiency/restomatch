import 'server-only';
import { and, discrepancies, inArray, matchRuns, eq, sql, withRestaurant, type Database, type UserRole } from '@restomatch/db';
import { notZeroShortTwin } from '@restomatch/charts';

/**
 * "ממתין להחלטה שלך" — the viewer's WHOLE decision queue in ₪ and count, as one
 * server-side aggregate (never a capped page, never a client-side sum).
 *
 * The filters mirror approvals.myQueue exactly (open/escalated, routed to a role
 * the viewer sees, the zero-₪ QTY_SHORT twin hidden), so the row count here is the
 * number of rows the approvals landing lists. ₪ at risk is Σ|Δ| without PRICE_LOWER
 * (a lower price is never money at risk — the approvals strip's rule).
 *
 * Runs on the RLS app role under the restaurant GUC (withRestaurant) and is also
 * scoped by restaurant_id explicitly.
 *
 * TODO(W2-08): switch to approvals.queueSummary (W1-07) once it is on main, so the
 * home and the approvals landing read the same procedure.
 */

export interface DecideSummary {
  count: number;
  atRiskIls: number;
  blocking: number;
}

/**
 * Whose queue a role sees — a copy of packages/api lib/roles expandVisibleRoles
 * (not exported from @restomatch/api); the test pins the two together via myQueue.
 */
export function visibleRoles(role: UserRole): UserRole[] {
  return role === 'owner' ? ['owner', 'manager', 'bookkeeper'] : [role];
}

export async function decideSummary(db: Database, restaurantId: string, role: UserRole): Promise<DecideSummary> {
  const [row] = await withRestaurant(db, restaurantId, (tx) =>
    tx
      .select({
        count: sql<number>`count(*)::int`,
        atRiskAgorot: sql<string>`coalesce(sum(case when ${discrepancies.type} <> 'PRICE_LOWER' then round(abs(coalesce(${discrepancies.deltaAmount}, 0)) * 100) else 0 end), 0)::bigint`,
        blocking: sql<number>`count(*) filter (where ${discrepancies.severity} = 'block')::int`,
      })
      .from(discrepancies)
      .innerJoin(matchRuns, eq(matchRuns.id, discrepancies.matchRunId))
      .where(
        and(
          eq(discrepancies.restaurantId, restaurantId),
          inArray(discrepancies.resolutionStatus, ['open', 'escalated']),
          notZeroShortTwin(),
          inArray(discrepancies.requiresRole, visibleRoles(role)),
        ),
      ),
  );
  return {
    count: Number(row?.count ?? 0),
    atRiskIls: Number(row?.atRiskAgorot ?? 0) / 100,
    blocking: Number(row?.blocking ?? 0),
  };
}
