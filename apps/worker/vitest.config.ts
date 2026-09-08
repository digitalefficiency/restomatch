import { defineConfig } from 'vitest/config';

/**
 * apps/worker suite. Mirrors packages/api: forks + singleFork because the
 * default threads pool's vite-env transport times out on cold/CI runners.
 *
 * Redis-backed tests must gate on REDIS_URL (skip when unset) — CI provides a
 * job-scoped Redis service ONLY for this package (see .github/workflows/ci.yml),
 * never repo-wide, so the API suites keep their in-memory rate-limit/queue paths.
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
