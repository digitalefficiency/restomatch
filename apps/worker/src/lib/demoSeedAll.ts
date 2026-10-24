/**
 * `pnpm demo:seed-all` — the plan and the guards (pure; the runner is
 * apps/worker/scripts/demo-seed-all.ts). One command seeds every demo extra,
 * in order, on a fresh database (local, or the NEW Supabase demo project):
 *
 *   seed (core, TRUNCATEs) → seed-demo → seed-chain-demo → seed-recovery-demo
 *   → seed-recipes-demo → seed-wave1-contracts-demo
 *
 * Steps whose script is not on this branch yet (a wave-1 feature not merged)
 * are skipped with a notice, never failed. Each step is itself idempotent; the
 * core seed wipes tenant data first, so a re-run with --reset reproduces the
 * same demo.
 */
import { LOCAL_DB_HOSTS, PRODUCTION_DB_MARKERS, seedTargetProblem } from '@restomatch/db';

export interface SeedStep {
  key: string;
  label: string;
  /** Package directory (relative to the repo root) the script runs in. */
  cwd: 'packages/db' | 'apps/worker';
  /** Script path relative to `cwd`; alternatives are tried in order. */
  scripts: string[];
  /** Missing script ⇒ skip (wave-1 extras) instead of failing (core steps). */
  optional: boolean;
  /** Table its migration creates: absent on the target ⇒ skip (migration not applied there yet). */
  requiresTable?: string;
}

export const SEED_STEPS: SeedStep[] = [
  { key: 'core', label: 'base seed (restaurant, team, suppliers, POs)', cwd: 'packages/db', scripts: ['scripts/seed.ts'], optional: false },
  { key: 'demo', label: 'deliveries, invoices, matching (seed-demo)', cwd: 'apps/worker', scripts: ['scripts/seed-demo.ts'], optional: false },
  { key: 'chain', label: 'chain: 2 more branches (S8)', cwd: 'apps/worker', scripts: ['scripts/seed-chain-demo.ts'], optional: true },
  { key: 'recovery', label: '₪-back recovery states (S12)', cwd: 'apps/worker', scripts: ['scripts/seed-recovery-demo.ts'], optional: true, requiresTable: 'recovery_claims' },
  { key: 'recipes', label: 'recipes / food cost per dish (S17)', cwd: 'apps/worker', scripts: ['scripts/seed-recipes-demo.ts'], optional: true, requiresTable: 'recipes' },
  {
    key: 'contracts',
    label: 'contract price lists + price alerts (S11)',
    cwd: 'apps/worker',
    scripts: ['scripts/seed-wave1-contracts-demo.ts', 'scripts/seed-contracts-demo.ts'],
    optional: true,
    requiresTable: 'supplier_contract_prices',
  },
];

/** The well-known default password from packages/db/scripts/seed.ts — never on a remote DB. */
export const PUBLIC_DEMO_PASSWORD = 'RestoMatch-Demo-2026!';
export const MIN_REMOTE_PASSWORD_LENGTH = 12;

export interface SeedAllArgs {
  reset: boolean;
}

export function parseSeedAllArgs(argv: string[]): SeedAllArgs {
  const unknown = argv.filter((a) => a !== '--reset' && a !== '--');
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(' ')} (only --reset is accepted)`);
  return { reset: argv.includes('--reset') };
}

/**
 * Shared Supabase poolers (aws-0-<region>.pooler.supabase.com) serve every
 * project in a region: the project is chosen by the USERNAME (postgres.<ref>),
 * so an allow-listed pooler host would admit any project. demo:seed-all only
 * accepts a project's own direct host (db.<ref>.supabase.co).
 */
export function isSharedPoolerHost(host: string): boolean {
  return /(^|\.)pooler\.supabase\.com$/i.test(host);
}

/**
 * The role the driver will really connect as: postgres-js percent-decodes the
 * URL username and falls back to PGUSER when it is empty — both must be checked
 * for the production project ref, not just the raw URL text.
 */
export function effectiveUser(url: string, env: NodeJS.ProcessEnv): string {
  let user = '';
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    user = '';
  }
  return user || env.PGUSER || '';
}

export function isRemoteHost(url: string): boolean {
  try {
    return !LOCAL_DB_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Every reason not to start, before anything is written. `existingRows` is the
 * number of restaurants + users already in the target (null = not checked yet).
 */
export function seedAllProblems(input: {
  url: string | undefined;
  env: NodeJS.ProcessEnv;
  args: SeedAllArgs;
  /** Rows the base seed would wipe (restaurants, users and what TRUNCATE … CASCADE reaches). */
  existingRows: number | null;
}): string[] {
  const { url, env, args, existingRows } = input;
  if (!url) return ['DATABASE_URL is required'];
  const problems: string[] = [];
  const guard = seedTargetProblem(url, env);
  if (guard) problems.push(guard);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* seedTargetProblem already reported an invalid URL */
  }
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* keep the raw text */
  }
  const who = `${decoded} ${effectiveUser(url, env)} ${env.PGHOST ?? ''} ${env.PGDATABASE ?? ''}`.toLowerCase();
  if (!guard && PRODUCTION_DB_MARKERS.some((m) => who.includes(m))) {
    problems.push('refusing: the connection names the old PRODUCTION project (decoded user / PGUSER / PGHOST)');
  }
  if (host && isSharedPoolerHost(host)) {
    problems.push(
      `refusing: ${host} is a shared Supabase pooler (any project can sit behind it) — use the project's direct host db.<ref>.supabase.co`,
    );
  }
  if (isRemoteHost(url)) {
    const pw = env.DEMO_PASSWORD?.trim();
    if (!pw) problems.push('DEMO_PASSWORD is required on a remote database (there is no default off localhost)');
    else if (pw === PUBLIC_DEMO_PASSWORD) problems.push('DEMO_PASSWORD must not be the public default password on a remote database');
    else if (pw.length < MIN_REMOTE_PASSWORD_LENGTH) problems.push(`DEMO_PASSWORD must be at least ${MIN_REMOTE_PASSWORD_LENGTH} characters on a remote database`);
  }
  if (existingRows != null && existingRows > 0 && !args.reset) {
    problems.push(
      `the database is not empty (${existingRows} rows in restaurants/users/billing/audit) — the base seed DELETES every tenant; pass --reset to confirm`,
    );
  }
  return problems;
}

/**
 * Tables the base seed empties: `TRUNCATE restaurants, users CASCADE` reaches
 * every table with an FK to either (even rows holding NULL there) — billing and
 * the audit log included. Any row in any of them ⇒ the DB is "not empty".
 */
export const WIPED_TABLES = [
  'restaurants',
  'users',
  'billing_accounts',
  'subscriptions',
  'usage_counters',
  'billing_events',
  'audit_log',
] as const;
