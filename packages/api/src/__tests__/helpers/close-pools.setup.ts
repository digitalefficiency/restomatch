/**
 * Test-only: close every Postgres pool a test file opens, when that file ends.
 *
 * The suites run serially in ONE forked process (singleFork). A file's
 * `createDb()` pool used to stay open until postgres.js's 20 s idle timeout, so
 * every file that ran in the last ~20 s still held its connections. With
 * train C's extra suites, CI (whose serial run is fast) reached Postgres's
 * 100-connection limit ("sorry, too many clients already") and unrelated tests
 * failed. This setup wraps `createDb` from `@restomatch/db`, records each pool,
 * and ends them all in an afterAll that runs after the file's own afterAll
 * hooks (vitest runs after-hooks in stack order, setup-file hooks last).
 *
 * App code is unchanged: the wrapper only exists inside vitest.
 */
import { afterAll, vi } from 'vitest';

type Closable = { $client?: { end?: (opts?: { timeout?: number }) => Promise<void> } };

const opened: Closable[] = [];

vi.mock('@restomatch/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@restomatch/db')>();
  return {
    ...mod,
    createDb: ((...args: Parameters<typeof mod.createDb>) => {
      const db = mod.createDb(...args);
      opened.push(db as unknown as Closable);
      return db;
    }) as typeof mod.createDb,
  };
});

afterAll(async () => {
  const pools = opened.splice(0);
  await Promise.all(pools.map((db) => db.$client?.end?.({ timeout: 5 }).catch(() => {})));
});
