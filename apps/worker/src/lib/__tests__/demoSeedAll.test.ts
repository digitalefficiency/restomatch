import { describe, expect, it } from 'vitest';
import { PUBLIC_DEMO_PASSWORD, SEED_STEPS, parseSeedAllArgs, seedAllProblems } from '../demoSeedAll';

const LOCAL = 'postgres://postgres:postgres@localhost:5432/restomatch_dev';
const NEW_PROJECT = 'postgresql://postgres:pw@db.newdemoref.supabase.co:5432/postgres';
const OLD_PROD = 'postgresql://postgres:pw@db.cringgshiafwsszyqufo.supabase.co:5432/postgres';
const noReset = { reset: false };

describe('demo:seed-all guards', () => {
  it('local, empty DB: no problems; DEMO_PASSWORD optional', () => {
    expect(seedAllProblems({ url: LOCAL, env: {}, args: noReset, existingRows: 0 })).toEqual([]);
  });

  it('needs DATABASE_URL', () => {
    expect(seedAllProblems({ url: undefined, env: {}, args: noReset, existingRows: null })).toEqual(['DATABASE_URL is required']);
  });

  it('refuses a non-empty DB without --reset, accepts it with --reset', () => {
    expect(seedAllProblems({ url: LOCAL, env: {}, args: noReset, existingRows: 6 }).join()).toMatch(/not empty.*--reset/);
    expect(seedAllProblems({ url: LOCAL, env: {}, args: { reset: true }, existingRows: 6 })).toEqual([]);
  });

  it('refuses a remote host unless SEED_ALLOW_REMOTE_HOST names it exactly', () => {
    const env = { DEMO_PASSWORD: 'a-private-demo-pass' };
    expect(seedAllProblems({ url: NEW_PROJECT, env, args: noReset, existingRows: 0 }).join()).toMatch(/not a local database/);
    expect(
      seedAllProblems({ url: NEW_PROJECT, env: { ...env, SEED_ALLOW_REMOTE_HOST: 'db.other.supabase.co' }, args: noReset, existingRows: 0 }).join(),
    ).toMatch(/not a local database/);
    expect(
      seedAllProblems({ url: NEW_PROJECT, env: { ...env, SEED_ALLOW_REMOTE_HOST: 'db.newdemoref.supabase.co' }, args: noReset, existingRows: 0 }),
    ).toEqual([]);
  });

  it('always refuses the old production project, even when allowed by host', () => {
    const env = { DEMO_PASSWORD: 'a-private-demo-pass', SEED_ALLOW_REMOTE_HOST: 'db.cringgshiafwsszyqufo.supabase.co' };
    expect(seedAllProblems({ url: OLD_PROD, env, args: { reset: true }, existingRows: 0 }).join()).toMatch(/PRODUCTION/);
  });

  it('a remote host requires a private DEMO_PASSWORD (no default, not the public one, ≥ 12 chars)', () => {
    const allow = { SEED_ALLOW_REMOTE_HOST: 'db.newdemoref.supabase.co' };
    const run = (DEMO_PASSWORD?: string) =>
      seedAllProblems({ url: NEW_PROJECT, env: { ...allow, ...(DEMO_PASSWORD != null ? { DEMO_PASSWORD } : {}) }, args: noReset, existingRows: 0 }).join();
    expect(run()).toMatch(/DEMO_PASSWORD is required/);
    expect(run('   ')).toMatch(/DEMO_PASSWORD is required/);
    expect(run(PUBLIC_DEMO_PASSWORD)).toMatch(/public default/);
    expect(run('short')).toMatch(/at least 12/);
    expect(run('a-private-demo-pass')).toBe('');
  });

  it('parses only --reset (pnpm passes "--" through)', () => {
    expect(parseSeedAllArgs([])).toEqual({ reset: false });
    expect(parseSeedAllArgs(['--', '--reset'])).toEqual({ reset: true });
    expect(() => parseSeedAllArgs(['--force'])).toThrow(/unknown argument/);
  });

  it('runs the steps in the agreed order; only the two core steps are mandatory', () => {
    expect(SEED_STEPS.map((s) => s.key)).toEqual(['core', 'demo', 'chain', 'recovery', 'recipes', 'contracts']);
    expect(SEED_STEPS.filter((s) => !s.optional).map((s) => s.key)).toEqual(['core', 'demo']);
    // Wave-1 extras skip when their migration is not applied on the target.
    expect(Object.fromEntries(SEED_STEPS.filter((s) => s.requiresTable).map((s) => [s.key, s.requiresTable]))).toEqual({
      recovery: 'recovery_claims',
      recipes: 'recipes',
      contracts: 'supplier_contract_prices',
    });
  });
});
