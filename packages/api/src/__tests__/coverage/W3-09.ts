import type { CoverageFragment } from './index';

// W3-09 (+ the AU-11 addendum): the order-autopilot procedures, with the suite that proves each.
const coverage: CoverageFragment = {
  'orders.preparedDrafts': "isolation — order-autopilot.attack.test.ts: A's banner lists only A's prepared drafts, never B's",
  'orders.dismissPreparedDraft': "attack — order-autopilot.attack.test.ts: A dismissing B's prepared draft → NOT_FOUND, B's draft stays a draft",
};
export default coverage;
