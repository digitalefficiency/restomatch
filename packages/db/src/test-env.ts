/**
 * Single source of truth for the TEST database connection string.
 *
 * Every DB-backed suite used to hard-code one developer's macOS username as the
 * fallback DSN, which bound the whole test protocol to a single machine. The
 * default now matches `docker-compose.yml` and `.github/workflows/ci.yml`
 * (user `postgres`, password `postgres`); a local brew Postgres without that
 * role should export `DATABASE_URL_TEST` instead (see STATE.md quick start).
 *
 * Kept dependency-free on purpose: vitest/playwright config files cannot import
 * workspace packages at config-load time, so they inline the same expression.
 */
export const DEFAULT_TEST_DB_URL = 'postgres://postgres:postgres@localhost:5432/restomatch_test';

export function testDbUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL_TEST;
  return url && url.length > 0 ? url : DEFAULT_TEST_DB_URL;
}
