import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // forks/singleFork — the default threads pool's vite-env transport times out
    // ("Timeout calling fetch on vite/env") on this DB-backed suite under cold /
    // detached runners. Matches api/matching/billing/catalog/charts.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
