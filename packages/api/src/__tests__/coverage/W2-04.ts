import type { CoverageFragment } from './index';

/** W2-04 — the approvals desk: bulk decide / bulk undo. */
const coverage: CoverageFragment = {
  'approvals.decideMany':
    "attack — approvals-bulk.attack.test.ts: one of A's ids inside B's batch → NOT_FOUND, nothing changes on either side",
  'approvals.reopenMany':
    "attack — approvals-bulk.attack.test.ts: B undoing A's id → NOT_FOUND, A's decided row stays decided",
};
export default coverage;
