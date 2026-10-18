import { createDb, type Database } from '@restomatch/db';
import { resolveWebDbUrl } from './env';

/**
 * The web app connects with a NON-OWNER, RLS-enforced role so the
 * row-level-security policies in packages/db/drizzle/rls/ are actually applied
 * (the table owner and service_role both bypass RLS).
 *
 * resolveWebDbUrl() is FAIL-CLOSED: it requires DATABASE_URL_APP and only falls
 * back to the owner DATABASE_URL when explicitly opted in for dev/test
 * (ALLOW_OWNER_DB=1 / NODE_ENV=test). No more silent owner fallback in prod.
 *
 * The worker and migrations keep using the owner/service DATABASE_URL — their
 * cross-tenant jobs are guarded explicitly in code.
 */
// One pool per server process. `next dev` instantiates this module once per
// compiled layer (RSC / SSR / route handlers) and again on every HMR reload;
// without the globalThis memo each copy opened its own 10-connection pool and
// the dev server hit Postgres' max_connections ("too many clients") after a few
// dozen page loads.
const memo = globalThis as unknown as { __restomatchWebDb?: Database };
export const db: Database = memo.__restomatchWebDb ?? createDb(resolveWebDbUrl());
memo.__restomatchWebDb = db;
