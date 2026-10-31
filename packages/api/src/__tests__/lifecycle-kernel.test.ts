import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyCoreTenantRls,
  auditLog,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import {
  discrepancyMachine,
  isTransitionConflict,
  transition,
  transitionMany,
  TRANSITION_CONFLICT_PREFIX,
} from '../lifecycle';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05 lifecycle kernel, on the RLS app role (no BYPASSRLS), like production:
 * guarded move, stale screen → CONFLICT with who/when and no audit row, replay
 * → success with ONE audit row, batch all-or-nothing, guard refusal.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;

function asTenant<T>(t: Tenant, fn: (tx: Database) => Promise<T>, userId = t.ownerUserId): Promise<T> {
  return withRestaurant(appDb, t.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/** Kernel audit rows of a discrepancy (the seed's `discrepancy.created` row is not a move). */
async function audits(id: string) {
  const rows = await ownerDb
    .select({ action: auditLog.action, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'discrepancy'), eq(auditLog.entityId, id)));
  return rows.filter((r) => r.action !== 'discrepancy.created');
}
async function statusOf(id: string) {
  const [d] = await ownerDb.select().from(discrepancies).where(eq(discrepancies.id, id));
  return d!;
}
async function extraDiscrepancy(t: Tenant, deltaAmount = '50.00') {
  const [d] = await ownerDb
    .insert(discrepancies)
    .values({ matchRunId: t.matchRunId, restaurantId: t.restaurantId, type: 'PRICE_HIGHER', severity: 'warn', deltaAmount })
    .returning();
  return d!.id;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'KA');
  B = await seedTenant(ownerDb, 'KB');
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('transition()', () => {
  it('a guarded move: open → accepted, stamped, one audit row with from/to/payload', async () => {
    const id = A.discrepancyId;
    const r = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, {
        id,
        restaurantId: A.restaurantId,
        event: 'accept',
        expectedFrom: 'open',
        actorId: A.ownerUserId,
        payload: { decision: 'claim' },
      }),
    );
    expect(r).toMatchObject({ id, from: 'open', to: 'accepted', replayed: false });
    const row = await statusOf(id);
    expect(row.resolutionStatus).toBe('accepted');
    expect(row.resolvedBy).toBe(A.ownerUserId);
    expect(row.resolvedAt).toBeInstanceOf(Date);
    const a = await audits(id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      action: 'discrepancy.approved',
      after: { machine: 'discrepancy', event: 'accept', from: 'open', to: 'accepted', decision: 'claim', payload: { decision: 'claim' } },
    });
  });

  it('a stale expectedFrom → CONFLICT naming the current status, who and when; nothing written', async () => {
    const id = A.discrepancyId;
    await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, { id, restaurantId: A.restaurantId, event: 'accept', expectedFrom: 'open', actorId: A.ownerUserId }),
    );
    const err = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, {
        id,
        restaurantId: A.restaurantId,
        event: 'reject',
        expectedFrom: 'open',
        actorId: A.ownerUserId,
        payload: { reason: 'stale card' },
      }),
    ).catch((e: unknown) => e);
    expect(isTransitionConflict(err)).toBe(true);
    const params = (err as { cause: { appParams: Record<string, string> } }).cause.appParams;
    expect(params).toMatchObject({ currentStatus: 'accepted', actorName: 'Owner KA', machine: 'discrepancy', event: 'reject' });
    expect(params.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((err as Error).message.startsWith(TRANSITION_CONFLICT_PREFIX)).toBe(true);
    expect((await statusOf(id)).resolutionStatus).toBe('accepted');
    expect((await statusOf(id)).resolutionNote).toBeNull();
    expect(await audits(id)).toHaveLength(1);
  });

  it('an illegal move with no expectedFrom is a CONFLICT too (the row is no longer decidable)', async () => {
    const id = A.discrepancyId;
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, id));
    const err = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, { id, restaurantId: A.restaurantId, event: 'accept', actorId: A.ownerUserId }),
    ).catch((e: unknown) => e);
    expect(isTransitionConflict(err)).toBe(true);
    expect(await audits(id)).toHaveLength(0);
  });

  it('a replay (double tap, retry after a lost response) is a success with ONE audit row', async () => {
    const id = A.discrepancyId;
    const input = {
      id,
      restaurantId: A.restaurantId,
      event: 'accept' as const,
      expectedFrom: 'open' as const,
      actorId: A.ownerUserId,
      payload: { decision: 'claim', note: 'x' },
    };
    await asTenant(A, (tx) => transition(tx, discrepancyMachine, input));
    const again = await asTenant(A, (tx) => transition(tx, discrepancyMachine, { ...input, payload: { note: 'x', decision: 'claim' } }));
    expect(again).toMatchObject({ id, to: 'accepted', replayed: true, effects: null });
    expect(await audits(id)).toHaveLength(1);
  });

  it('a "replay" with a DIFFERENT payload on an already-moved row is a CONFLICT, not a success', async () => {
    const id = A.discrepancyId;
    const base = { id, restaurantId: A.restaurantId, event: 'accept' as const, expectedFrom: 'open' as const, actorId: A.ownerUserId };
    await asTenant(A, (tx) => transition(tx, discrepancyMachine, { ...base, payload: { decision: 'claim' } }));
    const err = await asTenant(A, (tx) => transition(tx, discrepancyMachine, { ...base, payload: { decision: 'tolerate' } })).catch(
      (e: unknown) => e,
    );
    expect(isTransitionConflict(err)).toBe(true);
    expect(await audits(id)).toHaveLength(1);
  });

  it("another tenant's row is NOT_FOUND (app filter + RLS), and untouched", async () => {
    const err = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, { id: B.discrepancyId, restaurantId: A.restaurantId, event: 'accept', actorId: A.ownerUserId }),
    ).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('NOT_FOUND');
    expect((await statusOf(B.discrepancyId)).resolutionStatus).toBe('open');
  });

  it('an extra `where` guard that misses (routing changed) is a CONFLICT', async () => {
    const id = A.discrepancyId; // requiresRole = manager
    const err = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, {
        id,
        restaurantId: A.restaurantId,
        event: 'accept',
        expectedFrom: 'open',
        actorId: A.ownerUserId,
        where: eq(discrepancies.requiresRole, 'owner'),
      }),
    ).catch((e: unknown) => e);
    expect(isTransitionConflict(err)).toBe(true);
    expect((await statusOf(id)).resolutionStatus).toBe('open');
  });

  it('requiresReason and multi-target edges validate their input (BAD_REQUEST)', async () => {
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, A.discrepancyId));
    const err = await asTenant(A, (tx) =>
      transition(tx, discrepancyMachine, { id: A.discrepancyId, restaurantId: A.restaurantId, event: 'reopen', actorId: A.ownerUserId }),
    ).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('BAD_REQUEST');
  });

  it('two people deciding at the same moment: exactly one wins, one audit row', async () => {
    const id = A.discrepancyId;
    const results = await Promise.allSettled([
      asTenant(A, (tx) =>
        transition(tx, discrepancyMachine, { id, restaurantId: A.restaurantId, event: 'accept', expectedFrom: 'open', actorId: A.ownerUserId }),
      ),
      asTenant(A, (tx) =>
        transition(tx, discrepancyMachine, {
          id,
          restaurantId: A.restaurantId,
          event: 'reject',
          expectedFrom: 'open',
          actorId: A.ownerUserId,
          payload: { reason: 'x' },
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(isTransitionConflict(lost.reason)).toBe(true);
    expect(await audits(id)).toHaveLength(1);
  });
});

describe('transitionMany()', () => {
  it('is all-or-nothing: one stale item → per-item CONFLICT detail and nothing written', async () => {
    const d2 = await extraDiscrepancy(A);
    const d3 = await extraDiscrepancy(A);
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, d3));
    const r = await asTenant(A, (tx) =>
      transitionMany(tx, discrepancyMachine, {
        restaurantId: A.restaurantId,
        event: 'accept',
        actorId: A.ownerUserId,
        items: [
          { id: A.discrepancyId, expectedStatus: 'open' },
          { id: d2, expectedStatus: 'open' },
          { id: d3, expectedStatus: 'open' },
        ],
      }),
    );
    expect(r).toEqual({ ok: false, failures: [{ id: d3, code: 'CONFLICT', currentStatus: 'rejected' }] });
    expect((await statusOf(A.discrepancyId)).resolutionStatus).toBe('open');
    expect((await statusOf(d2)).resolutionStatus).toBe('open');
    expect(await audits(A.discrepancyId)).toHaveLength(0);
  });

  it('moves every item when all are fresh, one audit row each; per-item expectedStatus', async () => {
    const d2 = await extraDiscrepancy(A);
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'escalated' }).where(eq(discrepancies.id, d2));
    const r = await asTenant(A, (tx) =>
      transitionMany(tx, discrepancyMachine, {
        restaurantId: A.restaurantId,
        event: 'accept',
        actorId: A.ownerUserId,
        items: [
          { id: A.discrepancyId, expectedStatus: 'open' },
          { id: d2, expectedStatus: 'escalated' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect((await statusOf(A.discrepancyId)).resolutionStatus).toBe('accepted');
    expect((await statusOf(d2)).resolutionStatus).toBe('accepted');
    expect(await audits(A.discrepancyId)).toHaveLength(1);
    expect(await audits(d2)).toHaveLength(1);
  });

  it('a guard refusal (e.g. the bulk ₪ cap, enforced by the adopter) → REFUSED with its reason, nothing written', async () => {
    const big = await extraDiscrepancy(A, '450.00');
    const r = await asTenant(A, async (tx) =>
      transitionMany(tx, discrepancyMachine, {
        restaurantId: A.restaurantId,
        event: 'accept',
        actorId: A.ownerUserId,
        items: [
          { id: A.discrepancyId, expectedStatus: 'open' },
          { id: big, expectedStatus: 'open' },
        ],
        guard: async (item) => {
          const [d] = await tx.select({ delta: discrepancies.deltaAmount }).from(discrepancies).where(eq(discrepancies.id, item.id));
          return Number(d!.delta) > 200 ? 'over_bulk_cap' : null;
        },
      }),
    );
    expect(r).toEqual({ ok: false, failures: [{ id: big, code: 'REFUSED', currentStatus: 'open', reason: 'over_bulk_cap' }] });
    expect((await statusOf(A.discrepancyId)).resolutionStatus).toBe('open');
  });

  it("refuses another tenant's id as not_found and an event not allowed from the shown state", async () => {
    const r = await asTenant(A, (tx) =>
      transitionMany(tx, discrepancyMachine, {
        restaurantId: A.restaurantId,
        event: 'reopen',
        actorId: A.ownerUserId,
        items: [
          { id: B.discrepancyId, expectedStatus: 'accepted', to: 'open' },
          { id: A.discrepancyId, expectedStatus: 'open', to: 'open' },
        ],
      }),
    );
    expect(r).toEqual({
      ok: false,
      failures: [
        { id: B.discrepancyId, code: 'REFUSED', currentStatus: '', reason: 'not_found' },
        { id: A.discrepancyId, code: 'REFUSED', currentStatus: 'open', reason: 'not_allowed_from_state' },
      ],
    });
    expect((await statusOf(B.discrepancyId)).resolutionStatus).toBe('open');
  });

  it('a replayed batch (lost response) succeeds without second audit rows', async () => {
    const items = [{ id: A.discrepancyId, expectedStatus: 'open' as const }];
    const run = () =>
      asTenant(A, (tx) => transitionMany(tx, discrepancyMachine, { restaurantId: A.restaurantId, event: 'accept', actorId: A.ownerUserId, items }));
    expect((await run()).ok).toBe(true);
    const again = await run();
    expect(again.ok).toBe(true);
    expect(again.ok && again.results[0]?.replayed).toBe(true);
    expect(await audits(A.discrepancyId)).toHaveLength(1);
  });
});
