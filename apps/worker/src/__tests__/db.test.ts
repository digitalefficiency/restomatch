import { describe, expect, it } from 'vitest';
import { jobDb, jobDbPoolCount } from '../db';

// Regression for the per-job pool leak: jobs must share one pool per URL.
describe('jobDb', () => {
  it('returns the same pool for the same URL, however many jobs run', () => {
    const url = 'postgres://u:p@localhost:5432/never_connected';
    const first = jobDb(url);
    for (let i = 0; i < 50; i++) expect(jobDb(url)).toBe(first);
    expect(jobDbPoolCount()).toBe(1);
  });
});
