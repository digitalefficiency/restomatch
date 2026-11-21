import type { CoverageFragment } from './index';

/** W2-03 · the due-date desk + guarded mark-paid / reminder (probes in payrun.attack.test.ts). */
const coverage: CoverageFragment = {
  'payRun.list':
    "isolation — payrun.attack.test.ts: A's list never contains B's invoice, supplier or findings (also inside a ?m= window); receiver/chef FORBIDDEN",
  'payRun.markPaid':
    "attack — payrun.attack.test.ts: A marking B's invoiceId (alone or mixed) → NOT_FOUND with the flag on or off, same error as an unknown id, B untouched",
  'payRun.unmarkPaid':
    "attack — payrun.attack.test.ts: A unmarking B's invoiceId (alone or mixed) → NOT_FOUND with the flag on or off, B untouched; a reason is required",
  'payRun.remind':
    "attack — payrun.attack.test.ts: A reminding on B's invoiceId → NOT_FOUND (same as an unknown id); receiver/chef FORBIDDEN; nothing sent until G-06",
};
export default coverage;
