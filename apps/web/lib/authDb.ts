import { createDb, type Database } from '@restomatch/db';
import { dbEnvReport, resolveAuthDbUrl } from './env';

/**
 * Privileged connection for the IDENTITY layer only (Auth.js adapter +
 * membership resolution in the JWT callback).
 *
 * Auth.js needs full DML on users/accounts/sessions/verification_tokens, which
 * the RLS-enforced app role is deliberately denied (see packages/db/src/rls.ts).
 * So identity operations use the owner/service DATABASE_URL, while tenant data
 * (lib/db.ts) uses the non-owner DATABASE_URL_APP. Keep these separate.
 */
// One pool per process — see lib/db.ts (next dev re-instantiates modules per
// layer/HMR; unmemoized pools exhausted max_connections).
const memo = globalThis as unknown as { __restomatchAuthDb?: Database; __restomatchDbEnvReported?: boolean };

// Which DB variables are usable — and why not — in the build and boot logs,
// never the values (a pasted URL that `new URL` rejects failed the whole build).
if (process.env.NODE_ENV === 'production' && !memo.__restomatchDbEnvReported) {
  memo.__restomatchDbEnvReported = true;
  console.warn(`[env] ${dbEnvReport()}`);
}

// DATABASE_URL repaired if pasted with a common mistake; a placeholder that is
// never dialled during `next build` (see lib/env.ts).
const url = resolveAuthDbUrl();
if (!url) {
  throw new Error('DATABASE_URL is required for the auth connection');
}

export const authDb: Database = memo.__restomatchAuthDb ?? createDb(url);
memo.__restomatchAuthDb = authDb;
