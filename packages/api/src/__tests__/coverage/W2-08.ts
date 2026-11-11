// W2-08 COVERAGE fragment (W2-01 format): the task spine's procedures.
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'tasks.mine':
    "isolation — tasks-mine.test.ts: A sees only A tasks (B's blocking ₪ never in A's payload); a role argument other than the session's is refused, never widened",
  'nav.badges':
    "isolation — nav-badges.test.ts: A badges never include B queues; receiver/chef badges carry counts only (tasks-redaction.test.ts: no ₪ on the wire)",
  'nav.whereIs':
    "attack — nav-whereis.attack.test.ts: a non-member asking for B's invoice/po/supplier (and claim/count) gets exactly the random-uuid answer; a member of both gets {restaurantId, name, path}; one withRestaurant per other branch, only where the role may open the page (KIND_ROLES = route registry); removed membership → not found; bad id/kind → BAD_REQUEST",
};
export default coverage;
