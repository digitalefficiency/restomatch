/**
 * Reset + reseed ONLY the demo tenants ("כפר הזיתים" and its Haifa / Jerusalem
 * branches) at a given DEMO_TODAY — including whatever was added to them while
 * testing (invoices, duplicates, receipts, users invited into them). Every other
 * tenant is left untouched, and the script proves it: a per-table row count of
 * all NON-demo data is taken before and after and must be identical.
 *
 *   pnpm --filter @restomatch/worker reseed:demo -- --today 2026-10-25 --dry-run
 *   pnpm --filter @restomatch/worker reseed:demo -- --today 2026-10-25
 *
 * Steps (each one is safe to re-run; a failed run is fixed by running again):
 *   1. guards — DATABASE_URL must be local, or the remote host named in
 *      SEED_ALLOW_REMOTE_HOST AND (Supabase) the project ref in RESEED_PROJECT_REF;
 *      on a remote DB a non-default DEMO_PASSWORD is required
 *   2. find the demo tenants (packages/db/src/demoTenants.ts) — refuses if they are
 *      mixed with real data — and print what would be deleted, per table
 *   3. --dry-run stops here (read-only)
 *   4. base seed in demo-only mode (deletes the demo tenants in one transaction,
 *      recreates the restaurant, team, suppliers, catalog, POs), seed-demo
 *      (receipts, invoices, matching, approvals), seed-chain-demo (branches)
 *   5. verify: non-demo data unchanged, demo hero printed
 *
 * Docs (Hebrew, for the owner): docs/client-ready/RESEED-PROD.md
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLeakHero } from '@restomatch/charts';
import {
  assertSeedTarget,
  createDb,
  DEMO_MAIN_BUSINESS_ID,
  demoTenantRowCounts,
  findDemoTenants,
  isLocalDbUrl,
  supabaseProjectRef,
} from '@restomatch/db';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_DEMO_PASSWORD = 'RestoMatch-Demo-2026!';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes('--dry-run');
const today = arg('today') ?? process.env.DEMO_TODAY;
const url = process.env.DATABASE_URL;

function fail(msg: string): never {
  console.error(`[reseed-demo] ${msg}`);
  process.exit(1);
}

if (!url) fail('DATABASE_URL is required');
if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) fail('--today YYYY-MM-DD is required (the demo day)');
try {
  assertSeedTarget(url, 'reseed-demo');
} catch (e) {
  fail((e as Error).message);
}
const local = isLocalDbUrl(url);
if (!local) {
  const ref = supabaseProjectRef(url);
  const want = process.env.RESEED_PROJECT_REF?.trim().toLowerCase();
  if (!want) fail(`remote database: set RESEED_PROJECT_REF to the Supabase project ref you mean to reseed (this URL points at ${ref ?? 'an unknown project'})`);
  if (ref !== want) fail(`RESEED_PROJECT_REF=${want} but DATABASE_URL points at project ${ref ?? '(unknown)'} — refusing`);
  const pw = process.env.DEMO_PASSWORD?.trim();
  if (!pw || pw === DEFAULT_DEMO_PASSWORD) fail('remote database: set DEMO_PASSWORD to a private value (the default is public in the repo)');
}

/** Row counts of every restaurant-scoped table OUTSIDE the demo tenants (+ users, restaurants). */
async function nonDemoFingerprint(sql: postgres.Sql, demoRids: string[], demoUids: string[]): Promise<Record<string, number>> {
  const rids = demoRids.length ? demoRids : ['00000000-0000-0000-0000-000000000000'];
  const uids = demoUids.length ? demoUids : ['00000000-0000-0000-0000-000000000000'];
  const tables = (await sql`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'restaurant_id' and not a.attisdropped
    where c.relkind in ('r', 'p') order by 1
  `) as unknown as Array<{ t: string }>;
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    out[t] = Number((await sql`select count(*)::int as n from ${sql(t)} where restaurant_id is null or restaurant_id not in ${sql(rids)}`)[0]!.n);
  }
  out.restaurants = Number((await sql`select count(*)::int as n from restaurants where id not in ${sql(rids)}`)[0]!.n);
  out.users = Number((await sql`select count(*)::int as n from users where id not in ${sql(uids)}`)[0]!.n);
  return out;
}

function run(label: string, cmd: string[], env: NodeJS.ProcessEnv) {
  console.log(`\n[reseed-demo] ▶ ${label}`);
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}). Nothing outside the demo tenants was touched; fix the cause and run the same command again.`);
}

async function main() {
  const sql = postgres(url!, { max: 1, prepare: false, onnotice: () => undefined });
  const target = local ? 'local database' : `Supabase project ${supabaseProjectRef(url!)}`;
  try {
    const tenants = await findDemoTenants(sql);
    const counts = await demoTenantRowCounts(sql, tenants);
    const before = await nonDemoFingerprint(sql, tenants.restaurants.map((r) => r.id), tenants.userIds);
    console.log(`[reseed-demo] target: ${target} · DEMO_TODAY=${today}${dryRun ? ' · DRY RUN (nothing is changed)' : ''}`);
    console.log(`[reseed-demo] demo tenants found: ${tenants.restaurants.map((r) => `${r.name} (${r.businessId})`).join(', ') || 'none (first seed)'}`);
    console.log(`[reseed-demo] demo users: ${tenants.userIds.length} · billing accounts: ${tenants.billingAccountIds.length}`);
    console.log('[reseed-demo] rows that will be DELETED (demo tenants only):');
    for (const [t, n] of Object.entries(counts)) console.log(`    ${t.padEnd(32)} ${String(n).padStart(7)}`);
    console.log(`[reseed-demo] other tenants (left untouched): ${before.restaurants} restaurant(s), ${before.users} user(s)`);
    if (dryRun) return;

    const env = { ...process.env, DEMO_TODAY: today, SEED_SCOPE: 'demo' };
    run('base seed (demo tenants only)', ['pnpm', '--filter', '@restomatch/db', 'seed'], env);
    run('seed-demo (receipts, invoices, matching)', ['pnpm', '--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-demo.ts'], env);
    run('seed-chain-demo (Haifa + Jerusalem branches)', ['pnpm', '--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-chain-demo.ts'], env);

    const after = await findDemoTenants(sql);
    const afterFp = await nonDemoFingerprint(sql, after.restaurants.map((r) => r.id), after.userIds);
    const changed = Object.keys({ ...before, ...afterFp }).filter((k) => before[k] !== afterFp[k]);
    if (changed.length) {
      // The reseed never writes outside the demo tenants; a difference here means a
      // real user acted during the run (or something is wrong) — look before the demo.
      fail(`NON-demo row counts changed during the run: ${changed.map((k) => `${k} ${before[k]}→${afterFp[k]}`).join(', ')} — check before the demo`);
    }
    const db = createDb(url!);
    const main = after.restaurants.find((r) => r.businessId === DEMO_MAIN_BUSINESS_ID);
    if (main) {
      const h = await computeLeakHero(db, main.id);
      console.log(`\n[reseed-demo] ✔ done. Other tenants unchanged (${afterFp.restaurants} restaurant(s), ${afterFp.users} user(s)).`);
      console.log(`[reseed-demo] hero (${main.name}): ${JSON.stringify(h)}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
