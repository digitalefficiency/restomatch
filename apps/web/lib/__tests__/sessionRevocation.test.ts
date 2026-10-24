import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, sql } from '@restomatch/db';
import {
  PgRevocationStore,
  isSessionRevoked,
  revokeSession,
  setRevocationStoreForTests,
  type RevocationStore,
} from '../sessionRevocation';

// DB-backed: the local test database (vitest env DATABASE_URL). The suite applies
// the 0060 migration itself, the same SQL the migrator runs.
const db = createDb(process.env.DATABASE_URL!);
const MIGRATION = join(__dirname, '../../../../packages/db/drizzle/0060_revoked_sessions.sql');
const applyMigration = async () => {
  for (const stmt of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
    if (stmt.trim()) await db.execute(sql.raw(stmt));
  }
};
const count = async () =>
  Number(((await db.execute(sql`select count(*)::int as n from revoked_sessions`)) as unknown as Array<{ n: number }>)[0]!.n);

const SID_A = '11111111-1111-4111-8111-111111111111';
const SID_B = '22222222-2222-4222-8222-222222222222';

afterEach(() => setRevocationStoreForTests(undefined));
// The migration is idempotent (IF NOT EXISTS); the table is left in place.
beforeAll(applyMigration);

describe('sign-out deny-list fails OPEN when the table is missing', () => {
  it('a check on a DB without 0060 is "not revoked" + a warning — never a throw / 500', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ROLLBACK = new Error('rollback');
    // Drop the table inside a transaction that is always rolled back.
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`drop table revoked_sessions`);
        setRevocationStoreForTests(new PgRevocationStore(tx as unknown as typeof db));
        expect(await isSessionRevoked(SID_A)).toBe(false);
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('failing open');
    warn.mockRestore();
  });
});

describe('PgRevocationStore (migration 0060)', () => {
  it('a revoked sid is listed; another session of the same user is not', async () => {
    setRevocationStoreForTests(new PgRevocationStore(db));
    await revokeSession(SID_A);
    expect(await isSessionRevoked(SID_A)).toBe(true);
    expect(await isSessionRevoked(SID_B)).toBe(false);
  });

  it('revoking twice is idempotent and never shortens the expiry', async () => {
    const store = new PgRevocationStore(db);
    await store.add(SID_B, 3600);
    await store.add(SID_B, 1);
    const [row] = (await db.execute(
      sql`select extract(epoch from expires_at - now())::int as left from revoked_sessions where sid = ${SID_B}::uuid`,
    )) as unknown as Array<{ left: number }>;
    expect(row!.left).toBeGreaterThan(3000);
  });

  it('expired rows read as not revoked and are purged on the next write', async () => {
    await db.execute(
      sql`insert into revoked_sessions (sid, expires_at) values ('33333333-3333-4333-8333-333333333333', now() - interval '1 second')`,
    );
    const store = new PgRevocationStore(db);
    expect(await store.has('33333333-3333-4333-8333-333333333333')).toBe(false);
    const before = await count();
    await store.add('44444444-4444-4444-8444-444444444444', 60);
    expect(await count()).toBe(before); // +1 new, −1 expired
  });

  it('the tenant app role cannot see the table (RLS on, no policies)', async () => {
    const [rls] = (await db.execute(
      sql`select relrowsecurity as on, (select count(*)::int from pg_policies where tablename = 'revoked_sessions') as policies
            from pg_class where relname = 'revoked_sessions'`,
    )) as unknown as Array<{ on: boolean; policies: number }>;
    expect(rls).toEqual({ on: true, policies: 0 });
  });

  it('a non-uuid sid is ignored (no query, never revoked)', async () => {
    const add = vi.fn();
    const has = vi.fn();
    setRevocationStoreForTests({ add, has });
    await revokeSession('not-a-uuid');
    expect(await isSessionRevoked("x' or '1'='1")).toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(has).not.toHaveBeenCalled();
  });
});

describe('deadline', () => {
  it('a hung store fails open within the deadline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hung = { execute: () => new Promise(() => {}) } as unknown as ConstructorParameters<typeof PgRevocationStore>[0];
    setRevocationStoreForTests(new PgRevocationStore(hung, 50) as RevocationStore);
    const t0 = Date.now();
    expect(await isSessionRevoked(SID_A)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
    warn.mockRestore();
  });
});
