// W3-01 COVERAGE fragment (docs/ux/wave3/W3-01.md).
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'chain.matrix':
    'isolation — chain.attack.test.ts: per-branch withRestaurant (RLS); scope all/<id>/g:<group> limited to the caller-owned (or bookkeeper) memberships on the active account; B/M/X never in the payload; id or group outside → NOT_FOUND; forged session → FORBIDDEN',
  'chain.branchPeek':
    'attack — chain.attack.test.ts: peeking B, manager-only M, X on another account or a random uuid → NOT_FOUND; forged session → FORBIDDEN',
  'chain.byBranch':
    'isolation — chain.attack.test.ts: per-branch withRestaurant (RLS) with the single-branch readers; rows = A + A2 only, B/M/X never in the payload; scope outside the memberships → NOT_FOUND; manager / forged session → FORBIDDEN',
};
export default coverage;
