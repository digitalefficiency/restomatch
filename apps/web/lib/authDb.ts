import { createDb } from '@restomatch/db';

/**
 * Privileged connection for the IDENTITY layer only (Auth.js adapter +
 * membership resolution in the JWT callback).
 *
 * Auth.js needs full DML on users/accounts/sessions/verification_tokens, which
 * the RLS-enforced app role is deliberately denied (see packages/db/src/rls.ts).
 * So identity operations use the owner/service DATABASE_URL, while tenant data
 * (lib/db.ts) uses the non-owner DATABASE_URL_APP. Keep these separate.
 */
const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_APP;
if (!url) {
  throw new Error('DATABASE_URL is required for the auth connection');
}

export const authDb = createDb(url);
