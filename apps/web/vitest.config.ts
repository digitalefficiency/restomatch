import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const TEST_DB =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a real bundle — stub it for unit tests.
      'server-only': fileURLToPath(new URL('./test/serverOnlyStub.ts', import.meta.url)),
      // Mirror the tsconfig `@/*` path alias.
      '@': root.replace(/\/$/, ''),
    },
  },
  test: {
    include: ['{lib,app,test}/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // DB-backed; the auth connection (lib/authDb) reads DATABASE_URL at import.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      DATABASE_URL: TEST_DB,
      DATABASE_URL_TEST: TEST_DB,
      NODE_ENV: 'test',
      // Throwaway signing secret for handler-level tests — never the prod value.
      AUTH_SECRET: 'test-only-secret-not-production-0123456789',
      // Throwaway 32-byte (hex) key so the TOTP AES-GCM round-trip runs in tests.
      AUTH_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  },
});
