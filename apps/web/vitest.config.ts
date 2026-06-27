import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests only (no DB). DB-backed RLS coverage lives in
    // packages/api (rls.attack.test.ts). Keep this fast + dependency-free.
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
