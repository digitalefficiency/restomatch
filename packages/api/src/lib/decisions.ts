import { sql } from '@restomatch/db';

/**
 * Rounds 5/7/9: a finding a PERSON decided (loadPriorDecisions' rule: resolved_at
 * set, or escalated) or a credit claim hangs on. Engine auto-approvals
 * ('accepted' with no resolved_at) are not a decision. Alias d; rid-free (the
 * claim must match the finding's own restaurant).
 */
export const A_PERSONS_DECISION = sql.raw(`(d.resolved_at is not null or d.resolution_status = 'escalated'
  or exists (select 1 from recovery_claims c where c.discrepancy_id = d.id and c.restaurant_id = d.restaurant_id))`);
