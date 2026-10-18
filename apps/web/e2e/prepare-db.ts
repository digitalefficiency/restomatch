/**
 * e2e database bootstrap — run ONCE per `playwright test` by playwright.config.ts
 * (before the dev server starts). Gives the browser suite its own database so it
 * never fights the vitest suites (which TRUNCATE restomatch_test) or the
 * developer's restomatch_dev:
 *
 *   1. CREATE DATABASE restomatch_e2e (if missing) on the same server
 *   2. migrate (every journal entry) + provision-rls (policies + restomatch_app)
 *   3. seed + seed-demo  → the "כפר הזיתים" demo tenant, fully matched
 *   4. print `E2E_APP_URL=<restomatch_app DSN>` so the web server runs on the
 *      RLS-enforced app role, exactly like production.
 *
 * E2E_SKIP_SEED=1 skips step 3 when the DB already holds the demo tenant
 * (fast local re-runs). Refuses non-local hosts — it deletes tenant data.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error('[e2e-db] E2E_DATABASE_URL is required');
const parsed = new URL(url);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  throw new Error(`[e2e-db] refusing non-local database host ${parsed.hostname}`);
}
const dbName = parsed.pathname.replace(/^\//, '');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function run(args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync('pnpm', args, {
    cwd: repo,
    env: { ...process.env, DATABASE_URL: url!, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function main(): Promise<void> {
  const admin = new URL(url!);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const exists = await sql`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await sql.unsafe(`create database "${dbName.replace(/"/g, '')}"`);
  } finally {
    await sql.end();
  }

  run(['--filter', '@restomatch/db', 'migrate']);
  const rls = run(['--filter', '@restomatch/db', 'provision-rls', '--print-app-url']);
  const appUrl = /DATABASE_URL_APP=(\S+)/.exec(rls)?.[1];
  if (!appUrl) throw new Error('[e2e-db] provision-rls did not print DATABASE_URL_APP');

  let seeded = false;
  if (process.env.E2E_SKIP_SEED === '1') {
    const db = postgres(url!, { max: 1 });
    try {
      seeded = (await db`select 1 from restaurants limit 1`).length > 0;
    } finally {
      await db.end();
    }
  }
  if (!seeded) {
    run(['--filter', '@restomatch/db', 'seed']);
    run(['--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-demo.ts']);
  }
  // Last line is machine-read by playwright.config.ts.
  process.stdout.write(`E2E_APP_URL=${appUrl}\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
