/**
 * ONE command for the whole demo — `pnpm demo:seed-all [-- --reset]`.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/restomatch_dev pnpm demo:seed-all -- --reset
 *
 *   # the NEW Supabase demo project (never the old production one — refused):
 *   SEED_ALLOW_REMOTE_HOST=db.<ref>.supabase.co DEMO_PASSWORD='<private>' DEMO_TODAY=2026-10-19 \
 *     DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' pnpm demo:seed-all
 *
 * Runs, in order (each as its own process, stopping at the first failure):
 *   seed → seed-demo → seed-chain-demo → seed-recovery-demo → seed-recipes-demo
 *   → seed-wave1-contracts-demo   (wave-1 extras not on this branch are skipped)
 * then prints the demo numbers. Guards (src/lib/demoSeedAll.ts):
 *   - the seed guard: local hosts only, or SEED_ALLOW_REMOTE_HOST=<exact host>;
 *     the old production project is always refused;
 *   - a remote host needs DEMO_PASSWORD (no default, not the public one, ≥ 12 chars);
 *   - a non-empty database needs --reset (the base seed deletes every tenant);
 *   - the schema must already be migrated (pnpm db:migrate / the Supabase integration).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@restomatch/api';
import { computeLeakHero } from '@restomatch/charts';
import { createDb, sql } from '@restomatch/db';
import { SEED_STEPS, isRemoteHost, parseSeedAllArgs, seedAllProblems } from '../src/lib/demoSeedAll';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const url = process.env.DATABASE_URL;

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []));
const ils = (n: number) => `₪${Math.round(n).toLocaleString('en-US')}`;
const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);

function fail(lines: string[]): never {
  console.error(`[demo:seed-all] refusing:\n  - ${lines.join('\n  - ')}`);
  process.exit(2);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseSeedAllArgs(process.argv.slice(2));
  } catch (err) {
    fail([err instanceof Error ? err.message : String(err)]);
  }
  // Static guards first — before even connecting.
  const early = seedAllProblems({ url, env: process.env, args, existingRows: null });
  if (early.length > 0) fail(early);

  const db = createDb(url!);
  const probe = rows(
    await db.execute(sql`
      SELECT to_regclass('public.restaurants') IS NOT NULL AS migrated,
             to_regclass('public.recovery_claims') IS NOT NULL AS has_recovery
    `),
  )[0]!;
  if (!probe.migrated) fail(['the schema is not migrated — run `pnpm db:migrate` (+ provision-rls) first']);
  const [{ n } = { n: 0 }] = rows(
    await db.execute(sql`SELECT (SELECT count(*) FROM restaurants) + (SELECT count(*) FROM users) AS n`),
  ) as Array<{ n: unknown }>;
  const problems = seedAllProblems({ url, env: process.env, args, existingRows: Number(n) });
  if (problems.length > 0) fail(problems);

  const host = new URL(url!).hostname;
  console.log(
    `[demo:seed-all] target ${host}${isRemoteHost(url!) ? ' (remote)' : ''} · DEMO_TODAY=${process.env.DEMO_TODAY ?? 'today'}` +
      (args.reset ? ' · --reset' : ''),
  );

  const ran: string[] = [];
  const skipped: string[] = [];
  for (const step of SEED_STEPS) {
    const cwd = join(root, step.cwd);
    const script = step.scripts.find((s) => existsSync(join(cwd, s)));
    if (!script) {
      if (!step.optional) fail([`${step.key}: ${step.scripts[0]} is missing in ${step.cwd}`]);
      console.log(`\n[demo:seed-all] ⏭  ${step.key} — ${step.label}: not on this branch, skipped`);
      skipped.push(step.key);
      continue;
    }
    if (step.requiresTable) {
      const [t] = rows(await db.execute(sql`SELECT to_regclass(${`public.${step.requiresTable}`}) IS NOT NULL AS ok`));
      if (!t?.ok) {
        console.log(`\n[demo:seed-all] ⏭  ${step.key} — ${step.label}: table ${step.requiresTable} missing (migration not applied here), skipped`);
        skipped.push(step.key);
        continue;
      }
    }
    console.log(`\n[demo:seed-all] ▶ ${step.key} — ${step.label} (${step.cwd}/${script})`);
    const res = spawnSync('pnpm', ['exec', 'tsx', script], { cwd, env: process.env, stdio: 'inherit' });
    if (res.status !== 0) {
      console.error(`[demo:seed-all] ✖ ${step.key} failed (exit ${res.status ?? res.signal}). Fix and re-run with --reset.`);
      process.exit(1);
    }
    ran.push(step.key);
  }

  // Final numbers — the same functions the dashboard calls.
  const [main] = rows(
    await db.execute(sql`SELECT id, name FROM restaurants ORDER BY created_at ASC LIMIT 1`),
  ) as Array<{ id: string; name: string }>;
  if (!main) fail(['no restaurant after seeding']);
  const [hero, last] = await Promise.all([
    computeLeakHero(db, main.id),
    computeLeakHero(db, main.id, { monthOffset: -1 }),
  ]);
  const counts = rows(
    await db.execute(sql`
      SELECT (SELECT count(*) FROM restaurants) AS branches,
             (SELECT count(*) FROM users) AS users,
             (SELECT count(*) FROM invoices) AS invoices,
             to_regclass('public.recipes') IS NOT NULL AS has_recipes,
             to_regclass('public.supplier_contract_prices') IS NOT NULL AS has_contracts
    `),
  )[0]!;
  // Wave-1 tables may not exist on this branch: query them only when they do
  // (Postgres resolves every relation in a statement, even in an untaken CASE).
  const countOf = async (present: unknown, table: 'recipes' | 'supplier_contract_prices') =>
    present ? Number(rows(await db.execute(sql.raw(`SELECT count(*) AS n FROM ${table}`)))[0]?.n ?? 0) : null;
  const recipesCount = await countOf(counts.has_recipes, 'recipes');
  const contractCount = await countOf(counts.has_contracts, 'supplier_contract_prices');

  console.log('\n[demo:seed-all] ✔ done');
  console.log(`  steps: ${ran.join(' → ')}${skipped.length ? `  (skipped: ${skipped.join(', ')})` : ''}`);
  console.log(`  restaurant: ${main.name} · branches ${counts.branches} · users ${counts.users} · invoices ${counts.invoices}`);
  console.log(
    `  hero (this month): leak ${ils(hero.leakIls)} = ${pct(hero.leakPct)} of ${ils(hero.spendIls)} checked spend · ` +
      `caught before payment ${ils(hero.caughtBeforePaymentIls)} · claimed ${ils(hero.recoveredIls)} · ` +
      `${hero.invoicesWithLeak}/${hero.matchedInvoiceCount} invoices with a leak · ${hero.pendingLinkCount} pending link`,
  );
  console.log(`  last month: leak ${ils(last.leakIls)} = ${pct(last.leakPct)} of ${ils(last.spendIls)}`);
  // ₪-back numbers (S12) when this branch has them — looked up dynamically so
  // this script also runs on a base without the recovery feature.
  const rec = api as unknown as Record<string, unknown>;
  if (probe.has_recovery && ran.includes('recovery') && typeof rec.computeRecoverySummary === 'function') {
    type Sum = { claimedAgorot: number; creditedAgorot: number; outstandingAgorot: number; recoveryRate: number | null; overdueCount: number };
    const s = await (rec.computeRecoverySummary as (d: unknown, id: string) => Promise<Sum>)(db, main.id);
    const r = await (rec.returnedInMonth as (d: unknown, id: string) => Promise<{ returnedAgorot: number }>)(db, main.id);
    console.log(
      `  ₪ back: claimed ${ils(s.claimedAgorot / 100)} · credited ${ils(s.creditedAgorot / 100)} · ` +
        `returned this month ${ils(r.returnedAgorot / 100)} · owed ${ils(s.outstandingAgorot / 100)} · ` +
        `rate ${pct(s.recoveryRate)} · ${s.overdueCount} overdue`,
    );
  }
  if (recipesCount != null) console.log(`  recipes: ${recipesCount}`);
  if (contractCount != null) console.log(`  contract prices: ${contractCount}`);
  console.log(
    `  logins: owner@ / manager@ / receiver@ / bookkeeper@ / chef@kfar-hazeitim.test · password: ` +
      (process.env.DEMO_PASSWORD ? 'DEMO_PASSWORD' : 'the local default (docs/DB-RUNBOOK.md)'),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[demo:seed-all] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
