import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // forks/singleFork — consistent with the DB-backed packages and robust under
    // detached/CI runners (the default threads pool's vite-env transport can time
    // out there). These are pure unit tests, so singleFork stays fast (~0.4s).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
