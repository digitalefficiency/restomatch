/**
 * AU-07 COVERAGE fragment. One new procedure, `admin.automationKpis`: an
 * adminProcedure read (platform admin + TOTP), so it is 'admin-denial' like
 * every admin.* entry. Its cross-tenant scope (reads only input.restaurantId on
 * the owner connection), NOT_FOUND, zero writes and the admin_requires_2fa
 * refusal are pinned in admin-automation-kpis.test.ts.
 */
const fragment: Readonly<Record<string, string>> = {
  'admin.automationKpis': 'admin-denial',
};
export default fragment;
