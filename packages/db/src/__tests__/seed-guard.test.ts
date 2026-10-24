import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedTargetProblem } from '../seedGuard';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('seed guard (destructive dev tools refuse non-local databases)', () => {
  it('allows local databases', () => {
    for (const url of [
      'postgres://postgres:postgres@localhost:5432/restomatch_dev',
      'postgres://postgres:postgres@127.0.0.1:5432/restomatch_test',
      'postgres://postgres:postgres@[::1]:5432/restomatch_dev',
      'postgres://postgres:postgres@postgres:5432/restomatch_dev',
    ]) {
      expect(seedTargetProblem(url, {}), url).toBeNull();
    }
  });

  it('refuses remote hosts even when "localhost" or "_test" appears elsewhere in the URL', () => {
    for (const url of [
      'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres?application_name=localhost',
      'postgresql://postgres:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/restomatch_test',
      'postgresql://localhost:pw@evil.example.com:5432/x',
    ]) {
      expect(seedTargetProblem(url, {}), url).toMatch(/refusing/);
    }
  });

  it('allows a remote demo DB only by exact hostname opt-in, never production', () => {
    const demo = 'postgresql://postgres:pw@db.demo1234.supabase.co:5432/postgres';
    expect(seedTargetProblem(demo, { SEED_ALLOW_REMOTE_HOST: 'db.demo1234.supabase.co' })).toBeNull();
    expect(seedTargetProblem(demo, { SEED_ALLOW_REMOTE_HOST: 'supabase.co' })).toMatch(/refusing/);
    const prod = 'postgresql://postgres:pw@db.cringgshiafwsszyqufo.supabase.co:5432/postgres';
    expect(seedTargetProblem(prod, { SEED_ALLOW_REMOTE_HOST: 'db.cringgshiafwsszyqufo.supabase.co' })).toMatch(/PRODUCTION/);
  });

  it('scripts/seed.ts and scripts/reset.ts exit non-zero on a remote URL before connecting', () => {
    for (const script of ['scripts/seed.ts', 'scripts/reset.ts']) {
      const res = spawnSync('npx', ['tsx', script], {
        cwd: pkgRoot,
        env: { ...process.env, DATABASE_URL: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres?x=localhost' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(res.status, script).not.toBe(0);
      expect(`${res.stdout}${res.stderr}`, script).toMatch(/refusing: db\.example\.supabase\.co is not a local database/);
    }
  }, 120_000);

  it('scripts/seed.ts refuses a FULL wipe on a remote host even with the host opt-in (only SEED_SCOPE=demo runs there)', () => {
    const res = spawnSync('npx', ['tsx', 'scripts/seed.ts'], {
      cwd: pkgRoot,
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:pw@db.demo1234.supabase.co:5432/postgres',
        SEED_ALLOW_REMOTE_HOST: 'db.demo1234.supabase.co',
        SEED_SCOPE: '',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/refusing a FULL wipe/);
  }, 120_000);
});
