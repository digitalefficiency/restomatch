/**
 * Reset + reseed ONLY the demo tenants ("כפר הזיתים" and its Haifa / Jerusalem
 * branches) at a given DEMO_TODAY — including whatever was added to them while
 * testing (invoices, duplicates, receipts, users invited into them). Every other
 * tenant is left untouched, and the script proves it: a per-table row count of
 * all NON-demo data is taken before and after and must be identical (the
 * worker's own job queue excepted — it writes there every minute; see
 * FINGERPRINT_SKIPPED_TABLES in packages/db/src/demoTenants.ts).
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
 *   5. the feature seeds of src/lib/demoExtras.ts (recovery, recipes, contracts, …) — each
 *      one whose script + table exist here, scoped to the demo tenants; the leak hero
 *      is snapshotted before them and must be identical after
 *   6. verify: non-demo data unchanged, demo hero printed, check-demo invariants
 *
 * Docs (Hebrew, for the owner): docs/client-ready/RESEED-PROD.md
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
  nonDemoFingerprint,
  supabaseProjectRef,
} from '@restomatch/db';
import postgres from 'postgres';
import { checkDemo, demoNow } from './check-demo';
import { DEMO_EXTRA_STEPS, scriptIsDemoScoped } from '../src/lib/demoExtras';

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

function run(label: string, cmd: string[], env: NodeJS.ProcessEnv) {
  console.log(`\n[reseed-demo] ▶ ${label}`);
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}). Nothing outside the demo tenants was touched; fix the cause and run the same command again.`);
}

const WORKER = join(ROOT, 'apps', 'worker');

/** Which feature seeds run here: script present, table migrated, demo-scoped when remote. */
async function planExtras(sql: postgres.Sql) {
  const out = [];
  for (const step of DEMO_EXTRA_STEPS) {
    const script = step.scripts.find((s) => existsSync(join(WORKER, s)));
    const [t] = await sql`select to_regclass(${`public.${step.requiresTable}`}) is not null as ok`;
    const scopedOk = script ? scriptIsDemoScoped(readFileSync(join(WORKER, script), 'utf8')) : false;
    const why = !script ? 'script not on this checkout' : !t!.ok ? `table ${step.requiresTable} not migrated` : null;
    out.push({ step, script, run: !why, why, refuse: !why && !local && !scopedOk });
  }
  return out;
}

/** Every hero figure of every demo restaurant, this month and the last two. */
async function heroSnapshot(rids: string[], day: string): Promise<Record<string, string>> {
  const db = createDb(url!);
  const now = new Date(`${day}T12:00:00+03:00`);
  const out: Record<string, string> = {};
  for (const rid of rids) {
    for (const monthOffset of [0, -1, -2]) {
      const h = await computeLeakHero(db, rid, { now, monthOffset });
      out[`${rid.slice(0, 8)}@${monthOffset}`] = JSON.stringify(h);
    }
  }
  return out;
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
    const extras = await planExtras(sql);
    for (const e of extras) console.log(`[reseed-demo] feature seed ${e.step.key}: ${e.run ? `will run ${e.script}` : `skipped — ${e.why}`}`);
    const refused = extras.filter((e) => e.refuse);
    if (refused.length) {
      fail(`refusing: feature seed(s) not scoped to the demo tenants on a remote database: ${refused.map((e) => `${e.step.key} (${e.script})`).join(', ')} — the script must read DEMO_RESTAURANT_ID / DEMO_RESTAURANT_IDS`);
    }
    if (dryRun) return;

    const env = { ...process.env, DEMO_TODAY: today, SEED_SCOPE: 'demo' };
    run('base seed (demo tenants only)', ['pnpm', '--filter', '@restomatch/db', 'seed'], env);
    run('seed-demo (receipts, invoices, matching)', ['pnpm', '--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-demo.ts'], env);
    run('seed-chain-demo (Haifa + Jerusalem branches)', ['pnpm', '--filter', '@restomatch/worker', 'exec', 'tsx', 'scripts/seed-chain-demo.ts'], env);

    // Feature seeds: scoped to the demo tenants, and the leak hero must not move.
    const seeded = await findDemoTenants(sql);
    const mainId = seeded.restaurants.find((r) => r.businessId === DEMO_MAIN_BUSINESS_ID)?.id;
    if (!mainId) fail('the core seed did not create the demo restaurant');
    const heroBefore = await heroSnapshot(seeded.restaurants.map((r) => r.id), today!);
    const scoped = { ...env, DEMO_RESTAURANT_ID: mainId, DEMO_RESTAURANT_IDS: seeded.restaurants.map((r) => r.id).join(',') };
    for (const e of extras.filter((x) => x.run)) {
      run(`${e.step.label} (${e.script})`, ['pnpm', '--filter', '@restomatch/worker', 'exec', 'tsx', e.script!], scoped);
    }
    const heroAfter = await heroSnapshot(seeded.restaurants.map((r) => r.id), today!);
    const moved = Object.keys(heroBefore).filter((k) => heroBefore[k] !== heroAfter[k]);
    if (moved.length) fail(`a feature seed moved the leak hero: ${moved.map((k) => `${k}: ${heroBefore[k]} → ${heroAfter[k]}`).join('; ')}`);

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
      // At DEMO_TODAY when given (the same instant check:demo uses), else the real clock.
      const h = await computeLeakHero(db, main.id, today ? { now: demoNow(today) } : {});
      console.log(`\n[reseed-demo] ✔ done. Other tenants unchanged (${afterFp.restaurants} restaurant(s), ${afterFp.users} user(s)).`);
      console.log(`[reseed-demo] hero (${main.name}): ${JSON.stringify(h)}`);
    }
    const check = await checkDemo(url!, today!);
    for (const f of check.facts) console.log(`[reseed-demo]   ${f}`);
    if (!check.ok) fail(`demo data check failed:\n  - ${check.problems.join('\n  - ')}`);
    console.log('[reseed-demo] ✔ demo data coherent (hero band, today\'s POs incl. open HaSharon Produce, totals, approvals, branches)');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
