import { defineConfig } from 'vitest/config';

/**
 * apps/worker suite. Mirrors packages/api: forks + singleFork because the
 * default threads pool's vite-env transport times out on cold/CI runners.
 * DB-backed (the job queue is in Postgres — 0061); no Redis anywhere.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
