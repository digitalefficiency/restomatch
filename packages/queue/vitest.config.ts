import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // forks/singleFork: the DB test files share one queue table, and
    // jobs.db.test.ts's recoverStalled() is global, so run in parallel it
    // re-queues kick.db.test.ts's stale-lock job mid-test. Matches db/api.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
