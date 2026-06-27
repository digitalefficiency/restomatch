import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app's pure security/auth helpers (headers/CSP,
 * callbackUrl open-redirect guard, Auth.js cookie pinning, env boot-guards).
 * Scoped to `lib/**` so it never touches the Playwright e2e suite under `e2e/`
 * or anything needing a Next runtime.
 */
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
