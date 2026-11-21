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
import { registerEffectHandler, type DomainEvent } from '../events';
import { discrepancyMachine, hasColumn, isTransitionConflict, transition } from '../lifecycle';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/** G-05 discrepancy machine: decisions only from open|escalated; the decision is recorded. */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
/** Collection-time probe: `it.skipIf` needs the answer before the hooks run. */
const hasDecisionColumn = await hasColumn(ownerDb, 'discrepancies', 'decision');

function asTenant<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return withRestaurant(appDb, A.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${A.ownerUserId}, true)`);
    return fn(tx);
  });
}
async function row() {
  const [d] = await ownerDb.select().from(discrepancies).where(eq(discrepancies.id, A.discrepancyId));
  return d!;
}
async function moves() {
  const rows = await ownerDb
    .select({ action: auditLog.action, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'discrepancy'), eq(auditLog.entityId, A.discrepancyId)));
  return rows.filter((r) => r.action !== 'discrepancy.created');
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'DA');
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('discrepancy machine', () => {
  for (const decided of ['accepted', 'rejected', 'resolved'] as const) {
    it(`deciding from ${decided} → CONFLICT, nothing written`, async () => {
      await ownerDb.update(discrepancies).set({ resolutionStatus: decided }).where(eq(discrepancies.id, A.discrepancyId));
      for (const event of ['accept', 'reject', 'escalate', 'resolve'] as const) {
        const err = await asTenant((tx) =>
          transition(tx, discrepancyMachine, {
            id: A.discrepancyId,
            restaurantId: A.restaurantId,
            event,
            actorId: A.ownerUserId,
            payload: { reason: 'r' },
          }),
        ).catch((e: unknown) => e);
        expect(isTransitionConflict(err), `${event} from ${decided}`).toBe(true);
      }
      expect((await row()).resolutionStatus).toBe(decided);
      expect(await moves()).toHaveLength(0);
    });
  }

  it('escalate keeps provenance in the event payload and moves the routing in the same guarded UPDATE', async () => {
    const seen: DomainEvent[] = [];
    const off = registerEffectHandler('task', async (_db, e) => {
      seen.push(e);
    });
    try {
      await asTenant((tx) =>
        transition(tx, discrepancyMachine, {
          id: A.discrepancyId,
          restaurantId: A.restaurantId,
          event: 'escalate',
          expectedFrom: 'open',
          actorId: A.ownerUserId,
          payload: { fromRole: 'manager', toRole: 'owner', escalatedBy: A.ownerUserId },
          set: { requiresRole: 'owner' },
          where: eq(discrepancies.requiresRole, 'manager'),
        }),
      );
    } finally {
      off();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      type: 'discrepancy.escalated',
      entityId: A.discrepancyId,
      from: 'open',
      to: 'escalated',
      payload: { fromRole: 'manager', toRole: 'owner', escalatedBy: A.ownerUserId },
    });
    const r = await row();
    expect(r).toMatchObject({ resolutionStatus: 'escalated', requiresRole: 'owner', resolvedAt: null });
    expect((await moves())[0]?.after).toMatchObject({ payload: { fromRole: 'manager', toRole: 'owner' } });
  });

  it('a decision is recorded: interim in audit after.decision (default by event, or the explicit one)', async () => {
    await asTenant((tx) =>
      transition(tx, discrepancyMachine, {
        id: A.discrepancyId,
        restaurantId: A.restaurantId,
        event: 'reject',
        expectedFrom: 'open',
        actorId: A.ownerUserId,
        payload: { reason: 'זניח', decision: 'tolerate' },
      }),
    );
    const [m] = await moves();
    expect(m).toMatchObject({ action: 'discrepancy.rejected', after: { decision: 'tolerate' } });
    expect((await row()).resolutionNote).toBe('זניח');
  });

  it.skipIf(!hasDecisionColumn)('G-03 path: discrepancies.decision is written (skipped until G-03 is migrated here)', async () => {
    await asTenant((tx) =>
      transition(tx, discrepancyMachine, {
        id: A.discrepancyId,
        restaurantId: A.restaurantId,
        event: 'accept',
        expectedFrom: 'open',
        actorId: A.ownerUserId,
      }),
    );
    const [d] = (await ownerDb.execute(sql`SELECT decision::text AS decision FROM discrepancies WHERE id = ${A.discrepancyId}`)) as unknown as Array<{
      decision: string;
    }>;
    expect(d?.decision).toBe('claim');
  });

  it('reopen returns a decision to the state it came from and clears the stamp', async () => {
    const base = { id: A.discrepancyId, restaurantId: A.restaurantId, actorId: A.ownerUserId };
    await asTenant((tx) => transition(tx, discrepancyMachine, { ...base, event: 'escalate', expectedFrom: 'open' }));
    await asTenant((tx) => transition(tx, discrepancyMachine, { ...base, event: 'accept', expectedFrom: 'escalated' }));
    await asTenant((tx) => transition(tx, discrepancyMachine, { ...base, event: 'reopen', expectedFrom: 'accepted', to: 'escalated' }));
    expect(await row()).toMatchObject({ resolutionStatus: 'escalated', resolvedBy: null, resolvedAt: null });
    expect((await moves()).map((m) => m.action)).toEqual(['discrepancy.escalated', 'discrepancy.approved', 'discrepancy.reopened']);
  });
});
