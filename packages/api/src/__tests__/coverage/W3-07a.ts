/** W3-07a COVERAGE fragment (W2-01 / #180 format, see `coverage/README.md`). */
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'settings.planUsage':
    'isolation — settings-plan-usage.attack.test.ts: A sees only its own plan, quota and seats, never B’s; chef/receiver FORBIDDEN',
};
export default coverage;
