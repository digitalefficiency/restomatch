import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, leads, memberships, users } from '@restomatch/db';
import { appRouter } from '../index';
import { getEntitlements } from '../entitlements';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const db = createDb(TEST_DB_URL);

function adminCaller(userId: string) {
  const session: Session = { userId, restaurantId: null, role: null };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

let T: Tenant;
let adminUserId: string;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  T = await seedTenant(db, 'AdminT');
  const [admin] = await db
    .insert(users)
    .values({ email: 'ops@restomatch.co', name: 'Ops', isPlatformAdmin: true })
    .returning();
  adminUserId = admin!.id;
});

afterAll(async () => {
  await resetDb(db);
});

describe('adminProcedure authorization', () => {
  it('allows a user with is_platform_admin', async () => {
    await expect(adminCaller(adminUserId).admin.listRestaurants()).resolves.toBeDefined();
  });

  it('allows a user via PLATFORM_ADMIN_EMAILS allowlist', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner-AdminT@attack.test';
    try {
      await expect(adminCaller(T.ownerUserId).admin.listRestaurants()).resolves.toBeDefined();
    } finally {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    }
  });

  it('rejects a normal tenant user', async () => {
    await expect(adminCaller(T.ownerUserId).admin.listRestaurants()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('admin plan assignment wires the entitlement flow', () => {
  it('lists the restaurant as implicit trial before assignment', async () => {
    const rows = await adminCaller(adminUserId).admin.listRestaurants();
    const r = rows.find((x) => x.id === T.restaurantId);
    expect(r).toMatchObject({ planKey: 'trial', implicit: true });
  });

  it('assignPlan creates a billing account + subscription and flips entitlements', async () => {
    // implicit trial grants accounting_export
    expect((await getEntitlements(db, T.restaurantId)).features).toContain('accounting_export');

    const res = await adminCaller(adminUserId).admin.assignPlan({
      restaurantId: T.restaurantId,
      planKey: 'basic',
    });
    expect(res.planKey).toBe('basic');
    expect(res.billingAccountId).toBeTruthy();

    const ent = await getEntitlements(db, T.restaurantId);
    expect(ent.planKey).toBe('basic');
    expect(ent.active).toBe(true);
    expect(ent.features).toHaveLength(0); // basic has no features

    // listed with the real plan now
    const rows = await adminCaller(adminUserId).admin.listRestaurants();
    expect(rows.find((x) => x.id === T.restaurantId)).toMatchObject({
      planKey: 'basic',
      implicit: false,
    });
  });

  it('re-assigning changes the plan in place (single subscription per account)', async () => {
    const c = adminCaller(adminUserId);
    await c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'basic' });
    await c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' });
    const ent = await getEntitlements(db, T.restaurantId);
    expect(ent.planKey).toBe('pro');
    expect(ent.features).toContain('advanced_analytics');
  });

  it('setOverrides layers a feature onto a basic plan', async () => {
    const c = adminCaller(adminUserId);
    await c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'basic' });
    await c.admin.setOverrides({
      restaurantId: T.restaurantId,
      overrides: { features: ['accounting_export'] },
    });
    const ent = await getEntitlements(db, T.restaurantId);
    expect(ent.features).toContain('accounting_export');
  });

  it('setOverrides before any plan is a clean BAD_REQUEST', async () => {
    await expect(
      adminCaller(adminUserId).admin.setOverrides({
        restaurantId: T.restaurantId,
        overrides: { features: ['accounting_export'] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('admin action safety', () => {
  it('assignPlan is idempotent under concurrency: one account, one subscription', async () => {
    const c = adminCaller(adminUserId);
    const results = await Promise.allSettled([
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' }),
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' }),
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const accountIds = new Set(
      results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.billingAccountId] : [])),
    );
    expect(accountIds.size).toBe(1); // exactly one billing account created
    const ent = await getEntitlements(db, T.restaurantId);
    expect(ent.planKey).toBe('pro');
  });

  it('refuses to demote the last owner', async () => {
    await expect(
      adminCaller(adminUserId).admin.setMemberRole({
        restaurantId: T.restaurantId,
        userId: T.ownerUserId,
        role: 'chef',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows demoting an owner when another owner remains', async () => {
    const [second] = await db
      .insert(users)
      .values({ email: 'second-owner@test.local', emailVerified: new Date() })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: second!.id, restaurantId: T.restaurantId, role: 'owner' });
    await expect(
      adminCaller(adminUserId).admin.setMemberRole({
        restaurantId: T.restaurantId,
        userId: T.ownerUserId,
        role: 'manager',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects a 0 limit override (would silently hard-block)', async () => {
    await adminCaller(adminUserId).admin.assignPlan({
      restaurantId: T.restaurantId,
      planKey: 'pro',
    });
    await expect(
      adminCaller(adminUserId).admin.setOverrides({
        restaurantId: T.restaurantId,
        overrides: { limits: { invoicesPerMonth: 0 } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('admin leads', () => {
  it('lists captured leads', async () => {
    await db.insert(leads).values({ name: 'מסעדן סקרן', phone: '050-0000000', source: 'landing' });
    const rows = await adminCaller(adminUserId).admin.listLeads();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.name).toBe('מסעדן סקרן');
  });
});

// keep eq import meaningful for future direct assertions
void eq;
