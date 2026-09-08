import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The worker starts with `tsx src/index.ts` (type: module) — Node's native ESM
 * loader, NOT vitest's transform. This test spawns tsx on a script that imports
 * the worker's package graph, so a CommonJS-interop break (a named import from a
 * CJS-only dependency) fails CI instead of crashing the pilot worker at boot.
 */
const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('worker boot imports (native ESM loader)', () => {
  it('imports every workspace package through tsx without a transform', () => {
    const res = spawnSync('pnpm', ['exec', 'tsx', 'scripts/check-boot-imports.ts'], {
      cwd: workerRoot,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/unused' },
    });
    expect(res.stderr).not.toMatch(/does not provide an export named|ERR_MODULE_NOT_FOUND|SyntaxError/);
    expect(res.status, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('[check-boot-imports] ok');
  }, 150_000);
});
