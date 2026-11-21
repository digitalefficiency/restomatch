/** W2-14 COVERAGE fragment (W2-01 / #180 format, see `coverage/README.md`). */
import type { CoverageFragment } from './index';

const coverage: CoverageFragment = {
  'settings.effective': 'isolation — settings-admin.attack.test.ts: A reads only its own overrides, never B’s',
  'settings.history':
    'isolation — settings-admin.attack.test.ts: A never sees B’s settings audit rows; receiver/chef FORBIDDEN',
  'settings.myPhone': 'attack — settings-admin.attack.test.ts: reads only the caller’s own users row',
  'settings.setMyPhone':
    'attack — settings-admin.attack.test.ts: writes only the caller’s users row (WHERE id = session.userId); B’s phone untouched',
  'team.transferOwnership':
    'attack — settings-admin.attack.test.ts: a B user as target → NOT_FOUND, both tenants untouched; non-owner FORBIDDEN',
  'exports.summary': 'isolation — settings-admin.attack.test.ts: counts and ₪ equal A’s seed alone, never B’s invoices',
};
export default coverage;
