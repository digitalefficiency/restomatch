import { createDb, type Database } from '@restomatch/db';
import { BUILD_PHASE_DB_PLACEHOLDER, isNextBuildPhase } from './env';

/**
 * Privileged connection for the IDENTITY layer only (Auth.js adapter +
 * membership resolution in the JWT callback).
 *
 * Auth.js needs full DML on users/accounts/sessions/verification_tokens, which
 * the RLS-enforced app role is deliberately denied (see packages/db/src/rls.ts).
 * So identity operations use the owner/service DATABASE_URL, while tenant data
 * (lib/db.ts) uses the non-owner DATABASE_URL_APP. Keep these separate.
 */
// Build phase only: a placeholder that is never dialled (see lib/env.ts).
const url =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP ?? (isNextBuildPhase() ? BUILD_PHASE_DB_PLACEHOLDER : undefined);
if (!url) {
  throw new Error('DATABASE_URL is required for the auth connection');
}

// One pool per process — see lib/db.ts (next dev re-instantiates modules per
// layer/HMR; unmemoized pools exhausted max_connections).
const memo = globalThis as unknown as { __restomatchAuthDb?: Database };
export const authDb: Database = memo.__restomatchAuthDb ?? createDb(url);
memo.__restomatchAuthDb = authDb;
