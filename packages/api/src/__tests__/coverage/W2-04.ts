/**
 * W2-04 COVERAGE fragment (format: coverage/README.md of W2-01). Loaded by
 * `mergeCoverage()` once W2-01 lands; until then the type is local.
 * TODO(W2-01): `import type { CoverageFragment } from './index'` and type it.
 */
const coverage: Record<string, string> = {
  'approvals.decideMany':
    "attack — approvals-bulk.attack.test.ts: B's batch with one of A's ids → NOT_FOUND, nothing changes on either side",
  'approvals.reopenMany':
    "attack — approvals-bulk.attack.test.ts: B reopening A's decided id → NOT_FOUND, A's row stays decided",
};
export default coverage;

/**
 * Changed base entries (W2-04 adds inputs; the base declarations stay as they are):
 *  • approvals.myQueue  — `scope`, `invoiceIds`: approvals-bulk.attack.test.ts (A's invoiceIds → [] for B, scope 'all' never lists A).
 *  • approvals.approve  — `channel`, `expectedStatus`, `seenClaimAgorot`: approvals-scope.test.ts, approvals-claim-at-decision.test.ts.
 *  • approvals.history  — `limit`: approvals-bulk.attack.test.ts (A's id → [] for B).
 */
