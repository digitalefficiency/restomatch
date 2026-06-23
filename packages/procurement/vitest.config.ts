import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // forks/singleFork — avoid the default threads pool's vite-env transport
    // timeout under cold/detached runners. Matches the other packages.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
