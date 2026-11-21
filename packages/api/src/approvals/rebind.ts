/**
 * W2-04 — claims after a re-match. A re-match deletes the old run (its bare
 * claims released first by `releaseClaimsForRematch`) and re-applies the
 * people's decisions to the findings that still exist. This brings their
 * claims back under the ORIGINAL decider (`resolved_by`), never whoever ran the
 * re-match: one `materializeClaims` per decider. Shared by the worker
 * (`matchInvoice`) and `match.runForInvoice`.
 */
import { and, discrepancies, eq, inArray, isNotNull, type Database } from '@restomatch/db';
import { materializeClaims } from '../recovery/service';

export async function rebindDecidedClaims(db: Database, restaurantId: string, matchRunId: string): Promise<number> {
  const decided = await db
    .select({ id: discrepancies.id, by: discrepancies.resolvedBy })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.restaurantId, restaurantId),
        eq(discrepancies.matchRunId, matchRunId),
        inArray(discrepancies.resolutionStatus, ['accepted', 'resolved']),
        isNotNull(discrepancies.resolvedBy),
      ),
    );
  const byDecider = new Map<string, string[]>();
  for (const d of decided) byDecider.set(d.by!, [...(byDecider.get(d.by!) ?? []), d.id]);
  let created = 0;
  for (const [actorId, discrepancyIds] of byDecider) {
    created += await materializeClaims(db, { restaurantId, discrepancyIds, actorId });
  }
  return created;
}
