/**
 * Next.js startup hook. Fail fast on a misconfigured production environment
 * (missing DATABASE_URL_APP/RESEND/REDIS/etc.) instead of booting and degrading
 * silently. Runs once per server process, Node runtime only (the edge runtime
 * lacks the full process.env + the db module).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertWebEnv, assertAppRoleNoBypass, assertRlsEnabled } = await import('./lib/env');
  assertWebEnv();

  // Tenant-boundary boot guards (Epic 0.1/0.3). Only meaningful when we are
  // actually serving tenant traffic on the app role: in production the role is
  // mandatory; in dev we still run the guard when DATABASE_URL_APP is set (to
  // catch a role pointed at the owner) but skip it for the ALLOW_OWNER_DB
  // owner-fallback path, which is intentionally RLS-bypassing for local work.
  const usingAppRole = !!process.env.DATABASE_URL_APP;
  const isProd = process.env.NODE_ENV === 'production';
  if (usingAppRole || isProd) {
    const { db } = await import('./lib/db');
    // A misconfigured DATABASE_URL_APP pointing at owner/service_role would make
    // RLS silently inert — fail the boot loudly instead.
    await assertAppRoleNoBypass(db);
    // And prove the policies were actually applied (no forgotten/new table).
    await assertRlsEnabled(db);
  }
}
