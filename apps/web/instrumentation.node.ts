/**
 * Node-runtime half of the startup hook. Imported ONLY from instrumentation.ts
 * inside `if (process.env.NEXT_RUNTIME === 'nodejs')` — Next inlines
 * NEXT_RUNTIME per compilation, so webpack drops this module (and with it
 * lib/db → postgres → net/tls, lib/env → @restomatch/db → node:fs) from the EDGE
 * instrumentation bundle. An early `return` before the dynamic imports does NOT
 * achieve that: the module graph is built before dead-code elimination, so the
 * edge build failed with "Reading from node:fs is not handled" (CI web job,
 * plan v2 T0).
 */
export async function registerNode(): Promise<void> {
  const { assertWebEnv, assertAppRoleNoBypass, assertRlsEnabled } = await import('./lib/env');
  // Fail fast on a misconfigured production environment (missing
  // DATABASE_URL_APP/RESEND/REDIS/etc.) instead of booting and degrading silently.
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
