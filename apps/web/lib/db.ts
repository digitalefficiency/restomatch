import { createDb, type Database } from '@restomatch/db';
import * as schema from '@restomatch/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { resolveWebDbUrl } from './env';
import { gateClient, tenantGuard } from './tenantGuard';

/**
 * The web app connects with a NON-OWNER, RLS-enforced role so the
 * row-level-security policies in packages/db/drizzle/rls/ are actually applied
 * (the table owner and service_role both bypass RLS).
 *
 * resolveWebDbUrl() is FAIL-CLOSED: it requires DATABASE_URL_APP and only falls
 * back to the owner DATABASE_URL when explicitly opted in for dev/test
 * (ALLOW_OWNER_DB=1 / NODE_ENV=test). No more silent owner fallback in prod.
 *
 * Every query and transaction on `db` first waits for the tenant guard (the
 * role does not bypass RLS, every tenant table has RLS on — lib/tenantGuard.ts)
 * and never reaches the database unless it passed. The guard used to run in the
 * boot hook, where one dropped connection took the whole instance down.
 *
 * The worker and migrations keep using the owner/service DATABASE_URL — their
 * cross-tenant jobs are guarded explicitly in code.
 */
interface TenantDb {
  db: Database;
  ensureTenantGuard: () => Promise<void>;
}

function createTenantDb(): TenantDb {
  // ONE pool. `raw` is the only ungated handle on it and never leaves this
  // function: the guard's own queries run on it (they cannot wait on themselves).
  const raw = createDb(resolveWebDbUrl());
  const ensureTenantGuard = tenantGuard(raw);
  // The same pool as tenant code sees it: Drizzle over the gated client.
  const db: Database = drizzle(gateClient(raw.$client, ensureTenantGuard), { schema });
  return { db, ensureTenantGuard };
}

// One pool (and one guard verdict) per server process. `next dev` instantiates
// this module once per compiled layer (RSC / SSR / route handlers) and again on
// every HMR reload; without the globalThis memo each copy opened its own
// 10-connection pool and the dev server hit Postgres' max_connections ("too
// many clients") after a few dozen page loads. (A new key: the entry now carries
// the guard, so a pre-guard entry from an HMR'd older copy is never reused.)
const memo = globalThis as unknown as { __restomatchTenantDb?: TenantDb };
const tenant = (memo.__restomatchTenantDb ??= createTenantDb());

export const db: Database = tenant.db;

/**
 * Resolves once the tenant guard passed on this instance; rejects with its
 * verdict otherwise. Tenant queries on `db` already wait for it — call it only
 * to start the guard early (the boot hook's warm-up).
 */
export const ensureTenantGuard: () => Promise<void> = tenant.ensureTenantGuard;
