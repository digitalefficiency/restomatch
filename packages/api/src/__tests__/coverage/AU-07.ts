import type { CoverageFragment } from './index';

/**
 * AU-07 COVERAGE fragment. One new procedure, `admin.automationKpis`: an
 * adminProcedure read (platform admin + TOTP) on the cross-tenant owner
 * connection, scoped to input.restaurantId in every subquery. Pinned in
 * admin-automation-kpis.test.ts (access, scope, NOT_FOUND, one admin.viewed
 * row) and charts automation.test.ts (every table read ignores a foreign tenant).
 */
const coverage: CoverageFragment = {
  'admin.automationKpis':
    "attack — admin-automation-kpis.test.ts: owner and admin without TOTP → FORBIDDEN; unknown id → NOT_FOUND; A's whole result is identical before and after B is deleted",
};
export default coverage;
