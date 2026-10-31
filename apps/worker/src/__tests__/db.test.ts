import { describe, expect, it } from 'vitest';
import { jobDb, jobDbPoolCount } from '../db';

// Regression for the per-job pool leak: jobs must share one pool per URL.
describe('jobDb', () => {
  it('returns the same pool for the same URL, however many jobs run', () => {
    // The pool map is process-wide (globalThis — one pool even when Next loads the
    // module twice), so earlier suites in this fork may hold pools: count the delta.
    const url = 'postgres://u:p@localhost:5432/never_connected';
    const before = jobDbPoolCount();
    const first = jobDb(url);
    for (let i = 0; i < 50; i++) expect(jobDb(url)).toBe(first);
    expect(jobDbPoolCount()).toBe(before + 1);
  });
});

describe('closeJobDbs', () => {
  it('drains and forgets every pool', async () => {
    const { closeJobDbs, jobDb: get, jobDbPoolCount: n } = await import('../db');
    get('postgres://u:p@localhost:5432/never_connected_2');
    await closeJobDbs();
    expect(n()).toBe(0);
  });
});

// Wave-1 regression: price-alerts / recovery-reminders / monthly-report each
// called createDb(url) per run and leaked a pool per run. Every job module must
// go through the shared jobDb pool (type-only imports of createDb are fine).
describe('job modules', () => {
  it('never create their own pool', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = fileURLToPath(new URL('../jobs/', import.meta.url));
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /\bcreateDb\s*\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
