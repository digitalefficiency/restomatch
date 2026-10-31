import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The package's own vitest config only collects src/**. Offline scripts keep
 * their tests here; `pnpm --filter @restomatch/api test` runs both configs.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['scripts/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
