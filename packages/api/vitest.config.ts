import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // One process runs every file in turn: end each file's DB pools when it finishes,
    // or idle pools pile up past Postgres's connection limit (see the setup file).
    setupFiles: ['src/__tests__/helpers/close-pools.setup.ts'],
  },
});
