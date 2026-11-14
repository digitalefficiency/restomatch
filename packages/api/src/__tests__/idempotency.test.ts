import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyCoreTenantRls,
  auditLog,
  createDb,
  ensureRlsAppRole,
  eq,
  memberships,
  sql,
  testDbUrl,
  users,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { hasTable } from '../lifecycle';
import { idempotencyStore, withIdempotency } from '../lib/idempotency';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05 replay keys: same key + user + request → the recorded response (fn runs
 * once); same key, different request or user → CONFLICT. Interim store: one
 * `idempotency.recorded` audit row per key. G-03 store: `idempotency_keys`.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
/** Collection-time probe for `it.skipIf`: G-03's table is not migrated before ≥ 10.11. */
const hasKeysTable = await hasTable(ownerDb, 'idempotency_keys');
let appDb: Database;
let A: Tenant;
let colleagueId: string;

function call<T>(userId: string, key: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  return withRestaurant(appDb, A.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return withIdempotency({ db: tx, session: { restaurantId: A.restaurantId, userId } }, { key, procedure: 'receiving.confirmLine', input }, fn);
  });
}
async function recorded() {
  return ownerDb
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, A.restaurantId), eq(auditLog.action, 'idempotency.recorded')));
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'QA');
  const [u] = await ownerDb.insert(users).values({ email: 'colleague@idem.test', name: 'Noa' }).returning();
  colleagueId = u!.id;
  await ownerDb.insert(memberships).values({ userId: colleagueId, restaurantId: A.restaurantId, role: 'manager' });
});

afterAll(async () => {
  await resetDb(ownerDb);
});

function semantics(store: 'audit' | 'table') {
  it(`[${store}] same key, same request → the recorded response; fn runs once`, async () => {
    expect(await idempotencyStore(ownerDb)).toBe(store);
    let runs = 0;
    const fn = async () => ({ lineId: 'L1', counted: 8, run: ++runs, at: new Date('2026-10-31T10:00:00Z') });
    const first = await call(A.ownerUserId, 'k-1', { lineId: 'L1', qty: 8 }, fn);
    const again = await call(A.ownerUserId, 'k-1', { qty: 8, lineId: 'L1' }, fn);
    expect(runs).toBe(1);
    expect(again).toEqual({ lineId: 'L1', counted: 8, run: 1, at: '2026-10-31T10:00:00.000Z' });
    expect(first.run).toBe(1);
  });

  it(`[${store}] a different key runs again`, async () => {
    let runs = 0;
    const fn = async () => ++runs;
    await call(A.ownerUserId, 'k-1', { qty: 8 }, fn);
    await call(A.ownerUserId, 'k-2', { qty: 8 }, fn);
    expect(runs).toBe(2);
  });

  it(`[${store}] the same key with a different request hash → CONFLICT, fn does not run`, async () => {
    let runs = 0;
    const fn = async () => ++runs;
    await call(A.ownerUserId, 'k-1', { qty: 8 }, fn);
    const err = await call(A.ownerUserId, 'k-1', { qty: 9 }, fn).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('CONFLICT');
    expect(runs).toBe(1);
  });

  it(`[${store}] the same key from another user → CONFLICT`, async () => {
    await call(A.ownerUserId, 'k-1', { qty: 8 }, async () => 1);
    const err = await call(colleagueId, 'k-1', { qty: 8 }, async () => 2).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('CONFLICT');
  });

  it(`[${store}] two concurrent requests with one key: fn runs once, both get its response`, async () => {
    let runs = 0;
    const fn = async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true };
    };
    const [a, b] = await Promise.all([call(A.ownerUserId, 'k-c', { x: 1 }, fn), call(A.ownerUserId, 'k-c', { x: 1 }, fn)]);
    expect(runs).toBe(1);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
  });

  it(`[${store}] a mutation that fails records nothing (the key stays free)`, async () => {
    const err = await call(A.ownerUserId, 'k-f', { x: 1 }, async () => {
      throw new Error('boom');
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('boom');
    expect(await call(A.ownerUserId, 'k-f', { x: 1 }, async () => 'second')).toBe('second');
  });
}

describe.skipIf(hasKeysTable)('interim store: audit_log after.clientMutationId (until G-03 is deployed)', () => {
  semantics('audit');

  it('writes exactly one audit row per key, carrying clientMutationId, procedure, hash and user', async () => {
    await call(A.ownerUserId, 'k-1', { qty: 8 }, async () => 'r');
    await call(A.ownerUserId, 'k-1', { qty: 8 }, async () => 'r');
    const rows = await recorded();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({
      clientMutationId: 'k-1',
      procedure: 'receiving.confirmLine',
      userId: A.ownerUserId,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      response: 'r',
    });
  });
});

describe.skipIf(!hasKeysTable)('G-03 store: idempotency_keys (skipped until G-03 is migrated here)', () => {
  semantics('table');

  it('writes no interim audit row', async () => {
    await call(A.ownerUserId, 'k-1', { qty: 8 }, async () => 'r');
    expect(await recorded()).toHaveLength(0);
  });
});
