import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activityEvents,
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  auditLog,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  memberships,
  testDbUrl,
  users,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { DECIDED_CONFLICT_PREFIX, type DecidedConflict } from '../routers/approvals';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * APPROVALS CONCURRENCY ATTACK SUITE (W1-07, approvals-11) — on the RLS app role
 * (`restomatch_app`, no BYPASSRLS), like production.
 *
 * The owner sees manager-routed items (expandVisibleRoles), so two people can
 * hold the same open card. Before W1-07 a decision updated by id only: a stale
 * card silently flipped a decision someone else had made (claim ⇄ pay), wrote a
 * second audit row and a second activity row. Now every decision writes only a
 * row that is still open/escalated; the loser gets CONFLICT naming the decider.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let managerId: string;

function caller(userId: string, restaurantId: string, role: Session['role']) {
  const ctx: AppContext = { db: appDb, session: { userId, restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const owner = () => caller(A.ownerUserId, A.restaurantId, 'owner');
const manager = () => caller(managerId, A.restaurantId, 'manager');

async function rowOf(id: string) {
  const [d] = await ownerDb.select().from(discrepancies).where(eq(discrepancies.id, id));
  return d!;
}
async function decisionAudits(id: string) {
  const rows = await ownerDb
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'discrepancy'), eq(auditLog.entityId, id)));
  return rows.map((r) => r.action).filter((a) => a !== 'discrepancy.created');
}
async function activityRows(id: string) {
  return ownerDb.select().from(activityEvents).where(eq(activityEvents.entityId, id));
}
function conflictOf(err: unknown): DecidedConflict {
  const e = err as { code?: string; message?: string };
  expect(e.code).toBe('CONFLICT');
  expect(e.message?.startsWith(DECIDED_CONFLICT_PREFIX)).toBe(true);
  return JSON.parse(e.message!.slice(DECIDED_CONFLICT_PREFIX.length)) as DecidedConflict;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});

beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'CA');
  B = await seedTenant(ownerDb, 'CB');
  const [m] = await ownerDb.insert(users).values({ email: 'mgr@concurrency.test', name: 'Dana' }).returning();
  managerId = m!.id;
  await ownerDb.insert(memberships).values({ userId: managerId, restaurantId: A.restaurantId, role: 'manager' });
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('a stale card can never overwrite a newer decision', () => {
  it('manager claims, then the owner\'s stale "pay as billed" gets CONFLICT and changes nothing', async () => {
    const id = A.discrepancyId; // PRICE_HIGHER ₪100, manager-routed, visible to both
    await manager().approvals.approve({ discrepancyId: id });

    const err = await owner()
      .approvals.reject({ discrepancyId: id, reason: 'stale card' })
      .catch((e: unknown) => e);
    const c = conflictOf(err);
    expect(c).toMatchObject({ status: 'accepted', role: 'manager', self: false });
    expect(c.at).toEqual(expect.any(String));

    const row = await rowOf(id);
    expect(row.resolutionStatus).toBe('accepted');
    expect(row.resolvedBy).toBe(managerId);
    expect(row.resolutionNote).toBeNull();
    expect(await decisionAudits(id)).toEqual(['discrepancy.approved']);
    expect(await activityRows(id)).toHaveLength(1);
  });

  it('a second approve (double tap, second device) is a CONFLICT naming the same person, not a second claim', async () => {
    const id = A.discrepancyId;
    await manager().approvals.approve({ discrepancyId: id });
    const c = conflictOf(await manager().approvals.approve({ discrepancyId: id }).catch((e: unknown) => e));
    expect(c).toMatchObject({ status: 'accepted', self: true });
    expect(await decisionAudits(id)).toEqual(['discrepancy.approved']);
    expect(await activityRows(id)).toHaveLength(1);
  });

  it('escalating a decided item is refused and keeps its routing', async () => {
    const id = A.discrepancyId;
    await owner().approvals.reject({ discrepancyId: id, reason: 'זניח', reasonCode: 'negligible' });
    conflictOf(await manager().approvals.escalate({ discrepancyId: id }).catch((e: unknown) => e));
    const row = await rowOf(id);
    expect(row.resolutionStatus).toBe('rejected');
    expect(row.requiresRole).toBe('manager');
  });

  it('two people deciding at the same moment: exactly one wins, one audit row, one activity row', async () => {
    const id = A.discrepancyId;
    const results = await Promise.allSettled([
      manager().approvals.approve({ discrepancyId: id }),
      owner().approvals.reject({ discrepancyId: id, reason: 'race' }),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    conflictOf(lost[0]!.reason);

    const row = await rowOf(id);
    const audits = await decisionAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toBe(row.resolutionStatus === 'accepted' ? 'discrepancy.approved' : 'discrepancy.rejected');
    expect(await activityRows(id)).toHaveLength(1);
  });

  it('a foreign tenant still gets NOT_FOUND (never a CONFLICT that leaks the decision)', async () => {
    await caller(B.ownerUserId, B.restaurantId, 'owner').approvals.approve({ discrepancyId: B.discrepancyId });
    await expect(owner().approvals.reject({ discrepancyId: B.discrepancyId, reason: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(owner().approvals.reopen({ discrepancyId: B.discrepancyId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await rowOf(B.discrepancyId)).resolutionStatus).toBe('accepted');
  });
});

describe('approvals.reopen (undo) on the app role', () => {
  it('the decider undoes inside the window: back to open, compensating audit, feed row withdrawn', async () => {
    const id = A.discrepancyId;
    await manager().approvals.approve({ discrepancyId: id });
    const reopened = await manager().approvals.reopen({ discrepancyId: id });
    expect(reopened).toMatchObject({ resolutionStatus: 'open', resolvedBy: null, requiresRole: 'manager' });
    expect(await decisionAudits(id)).toEqual(expect.arrayContaining(['discrepancy.approved', 'discrepancy.reopened']));
    expect(await activityRows(id)).toHaveLength(0);
    // The item is a decision again — for anyone who can see it.
    expect((await owner().approvals.myQueue()).map((q) => q.id)).toContain(id);
  });

  it('someone else cannot undo my decision', async () => {
    const id = A.discrepancyId;
    await manager().approvals.approve({ discrepancyId: id });
    await expect(owner().approvals.reopen({ discrepancyId: id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await rowOf(id)).resolutionStatus).toBe('accepted');
  });

  it('a second undo is a CONFLICT, not a second compensating row', async () => {
    const id = A.discrepancyId;
    await manager().approvals.reject({ discrepancyId: id, reason: 'x' });
    await manager().approvals.reopen({ discrepancyId: id });
    await expect(manager().approvals.reopen({ discrepancyId: id })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await decisionAudits(id)).filter((a) => a === 'discrepancy.reopened')).toHaveLength(1);
  });
});
