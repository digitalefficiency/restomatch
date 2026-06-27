import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app's pure security helpers (headers/CSP, callbackUrl
 * open-redirect guard, Auth.js cookie pinning). Scoped to `lib/**` so it never
 * touches the Playwright e2e suite under `e2e/` or anything needing a Next
 * runtime. No build needed — these modules are dependency-free.
 */
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
