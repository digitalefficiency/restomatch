import type { CoverageFragment } from './index';

/** G-04 follow-ups (Q5). Add-only. */
const coverage: CoverageFragment = {
  'consolidated.markReviewed':
    "attack — consolidated-review.attack.test.ts: A marking B's invoice → NOT_FOUND, no audit row; B's marks never reach A's proposal; receiver/chef FORBIDDEN",
};
export default coverage;
