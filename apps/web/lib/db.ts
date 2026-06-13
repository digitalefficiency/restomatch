import { createDb } from '@restomatch/db';

/**
 * The web app should connect with a NON-OWNER, RLS-enforced role so the
 * row-level-security policies in packages/db/drizzle/rls/ are actually applied
 * (the table owner and service_role both bypass RLS). Prefer DATABASE_URL_APP;
 * fall back to DATABASE_URL only until that role is provisioned (Phase 2).
 *
 * The worker and migrations keep using the owner/service DATABASE_URL — their
 * cross-tenant jobs are guarded explicitly in code.
 */
const url = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL_APP or DATABASE_URL is required');
}

export const db = createDb(url);
