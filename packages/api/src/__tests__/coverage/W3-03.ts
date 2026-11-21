/**
 * W3-03 COVERAGE fragment (web push: subscriptions + per-event switches), merged by coverage/index.ts.
 */
import type { CoverageFragment } from './index';

const W3_03: CoverageFragment = {
  'push.status':
    "isolation — push-w3-03.attack.test.ts: A's device count and switches never include B's rows; the receiver sees field events only",
  'push.subscribe':
    'attack — push-w3-03.attack.test.ts: the row is always keyed to the session restaurant + user; non-https endpoints and malformed keys are refused',
  'push.unsubscribe':
    "attack — push-w3-03.attack.test.ts: A unsubscribing B's endpoint → removed:false, B's row untouched",
  'push.setPref':
    "attack — push-w3-03.attack.test.ts: A's switch never changes B's; a role switching another role's event → FORBIDDEN",
  'push.test':
    'attack — push-w3-03.attack.test.ts: no provider until H-05, so it reports skipped_no_provider and never sent; it reads no tenant data',
};

export default W3_03;
