import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  auditLog,
  createDb,
  ensureRlsAppRole,
  eq,
  notificationsOutbox,
  restaurants,
  testDbUrl,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { router } from '../trpc';
import type { AppContext, Session } from '../context';
import { automationsRouter } from '../routers/automations';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * AU-01 ATTACK SUITE — the automations router on the RLS-enforced app role
 * (`restomatch_app`, no BYPASSRLS), exactly like production. Add-only.
 *
 * - The input carries no restaurantId: A's owner can only ever write A's row.
 * - B's outbox rows never reach A's "last run" / "this week".
 * - Role gates: receiver / chef → FORBIDDEN on list + setEnabled; manager /
 *   bookkeeper → FORBIDDEN on setEnabled; a tenant member → FORBIDDEN on listForAdmin.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
const testRouter = router({ automations: automationsRouter });

let A: Tenant;
let B: Tenant;

function caller(t: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return testRouter.createCaller(ctx);
}

async function settingsOf(t: Tenant) {
  const [r] = await ownerDb.select({ s: restaurants.settings }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
  return r?.s as Record<string, unknown>;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  A = await seedTenant(ownerDb, 'AutoAtkA');
  B = await seedTenant(ownerDb, 'AutoAtkB');
});
afterAll(async () => {
  await resetDb(ownerDb);
});
beforeEach(async () => {
  await ownerDb.update(restaurants).set({ settings: {} });
});

describe('automations attack', () => {
  it("A's owner toggling writes only A's settings and A's audit row; B is untouched", async () => {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { priceAlerts: true } } as RestaurantSettings })
      .where(eq(restaurants.id, B.restaurantId));
    await caller(A).automations.setEnabled({ key: 'priceAlerts', on: false, clientMutationId: randomUUID() });
    expect(await settingsOf(A)).toEqual({ features: { priceAlerts: false } });
    expect(await settingsOf(B)).toEqual({ features: { priceAlerts: true } });
    const bAudit = await ownerDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, B.restaurantId), eq(auditLog.action, 'automations.toggled')));
    expect(bAudit).toHaveLength(0);
  });

  it('extra input keys (a smuggled restaurantId) are stripped, never reach B', async () => {
    await caller(A).automations.setEnabled({
      key: 'eveningDigest',
      on: false,
      clientMutationId: randomUUID(),
      // @ts-expect-error not part of the input
      restaurantId: B.restaurantId,
    });
    expect(await settingsOf(B)).toEqual({});
    expect(await settingsOf(A)).toEqual({ automations: { eveningDigest: false } });
  });

  it("B's outbox rows never count on A's list", async () => {
    await ownerDb.insert(notificationsOutbox).values({
      restaurantId: B.restaurantId,
      channel: 'email',
      target: 'b@t.test',
      body: 'b',
      dedupeKey: `eod-report:${B.restaurantId}:2026-11-04:b@t.test`,
    });
    const { rows } = await caller(A).automations.list();
    const eod = rows.find((r) => r.key === 'eveningDigest')!;
    expect(eod.lastRunAt).toBeNull();
    expect(eod.countThisWeek).toBe(0);
    const { rows: bRows } = await caller(B).automations.list();
    expect(bRows.find((r) => r.key === 'eveningDigest')!.lastRunAt).not.toBeNull();
  });

  it('receiver and chef → FORBIDDEN on list and setEnabled', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(caller(A, role).automations.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller(A, role).automations.setEnabled({ key: 'eveningDigest', on: false, clientMutationId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await settingsOf(A)).toEqual({});
  });

  it('manager and bookkeeper → FORBIDDEN on setEnabled', async () => {
    for (const role of ['manager', 'bookkeeper'] as const) {
      await expect(
        caller(A, role).automations.setEnabled({ key: 'priceAlerts', on: true, clientMutationId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await settingsOf(A)).toEqual({});
  });

  it('a tenant owner (not a platform admin) → FORBIDDEN on listForAdmin for any restaurant', async () => {
    const ctx: AppContext = { db: appDb, session: { userId: A.ownerUserId, restaurantId: null, role: null } };
    for (const id of [A.restaurantId, B.restaurantId]) {
      await expect(testRouter.createCaller(ctx).automations.listForAdmin({ restaurantId: id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });
});
