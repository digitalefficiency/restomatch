/**
 * Next.js startup hook. Fail fast on a misconfigured production environment
 * (missing DATABASE_URL_APP/RESEND/REDIS/etc.) instead of booting and degrading
 * silently. Runs once per server process, Node runtime only (the edge runtime
 * lacks the full process.env + the db module).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertWebEnv } = await import('./lib/env');
    assertWebEnv();
  }
}
