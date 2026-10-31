import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, auditLog, createDb, eq, leads, restaurants, testDbUrl, userCredentials, users } from '@restomatch/db';
import { appRouter } from '../index';
import { FEATURE_KEYS } from '../lib/features';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * Pilot admin controls (ציקטי go-live): the TOTP gate on the console, per-tenant
 * feature flags without SQL, a Pro trial with an end date, and audit rows for
 * admin reads of tenant data.
 */
const db = createDb(testDbUrl());

function adminCaller(userId: string) {
  const session: Session = { userId, restaurantId: null, role: null };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

const enrolTotp = (userId: string) =>
  db.insert(userCredentials).values({ userId, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });

let T: Tenant;
let adminUserId: string;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  T = await seedTenant(db, 'Pilot');
  const [admin] = await db
    .insert(users)
    .values({ email: 'ops-pilot@restomatch.co', name: 'Ops', isPlatformAdmin: true })
    .returning();
  adminUserId = admin!.id;
});

afterAll(async () => {
  await resetDb(db);
});

describe('adminProcedure requires an enrolled authenticator (TOTP)', () => {
  it('a platform admin without TOTP is refused with admin_requires_2fa, on reads and writes', async () => {
    const c = adminCaller(adminUserId);
    const twoFa = { code: 'FORBIDDEN', message: 'admin_requires_2fa' };
    await expect(c.admin.listRestaurants()).rejects.toMatchObject(twoFa);
    await expect(c.admin.getRestaurant({ restaurantId: T.restaurantId })).rejects.toMatchObject(twoFa);
    await expect(c.admin.listLeads()).rejects.toMatchObject(twoFa);
    await expect(c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' })).rejects.toMatchObject(twoFa);
    await expect(
      c.admin.setFeatures({ restaurantId: T.restaurantId, features: { contracts: true } }),
    ).rejects.toMatchObject(twoFa);
    // …and nothing was written.
    const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, T.restaurantId));
    expect((r!.settings as { features?: unknown }).features).toBeUndefined();
  });

  it('TOTP set up but not yet confirmed (no totp_enabled_at) is still refused', async () => {
    await db.insert(userCredentials).values({ userId: adminUserId, totpSecretEnc: 'ciphertext', totpEnabledAt: null });
    await expect(adminCaller(adminUserId).admin.listRestaurants()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'admin_requires_2fa',
    });
  });

  it('an allowlisted (PLATFORM_ADMIN_EMAILS) admin needs TOTP too', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner-Pilot@attack.test';
    try {
      await expect(adminCaller(T.ownerUserId).admin.listRestaurants()).rejects.toMatchObject({
        message: 'admin_requires_2fa',
      });
      await enrolTotp(T.ownerUserId);
      await expect(adminCaller(T.ownerUserId).admin.listRestaurants()).resolves.toBeDefined();
    } finally {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    }
  });

  it('TOTP does not make a non-admin an admin', async () => {
    await enrolTotp(T.ownerUserId);
    await expect(adminCaller(T.ownerUserId).admin.listRestaurants()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'platform admin only',
    });
  });

  it('a platform admin with TOTP enrolled gets in', async () => {
    await enrolTotp(adminUserId);
    await expect(adminCaller(adminUserId).admin.listRestaurants()).resolves.toBeDefined();
  });
});

describe('admin.setFeatures — per-tenant flags without SQL', () => {
  beforeEach(async () => {
    await enrolTotp(adminUserId);
  });

  it('merges into settings.features: other settings keys (tolerances) and other flags survive', async () => {
    const tolerances = { priceTolerancePct: 2, qtyTolerancePct: 1 };
    await db
      .update(restaurants)
      .set({ settings: { tolerances, features: { recipes: true, chain: false } } as never })
      .where(eq(restaurants.id, T.restaurantId));

    const res = await adminCaller(adminUserId).admin.setFeatures({
      restaurantId: T.restaurantId,
      features: { contracts: true, chain: true },
    });

    const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, T.restaurantId));
    expect(r!.settings).toEqual({ tolerances, features: { recipes: true, chain: true, contracts: true } });
    expect(res.features.effective.contracts).toBe(true);
    expect(res.features.effective.recipes).toBe(true);
    expect(res.features.effective.recovery).toBe(false);
  });

  it('turns a flag off with an explicit false (wins over the demo’s all), keeping all', async () => {
    await db.update(restaurants).set({ settings: { features: { all: true } } as never }).where(eq(restaurants.id, T.restaurantId));
    const res = await adminCaller(adminUserId).admin.setFeatures({
      restaurantId: T.restaurantId,
      features: { aiAssistant: false },
    });
    expect(res.features.all).toBe(true);
    expect(res.features.stored).toEqual({ all: true, aiAssistant: false });
    expect(res.features.effective.aiAssistant).toBe(false);
    expect(res.features.effective.contracts).toBe(true);
  });

  it('rejects "all", unknown keys, non-boolean values and an empty patch — nothing stored', async () => {
    const c = adminCaller(adminUserId);
    for (const features of [{ all: true }, { notAFeature: true }, { contracts: 'yes' }, {}]) {
      await expect(
        c.admin.setFeatures({ restaurantId: T.restaurantId, features: features as never }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, T.restaurantId));
    expect(r!.settings).toEqual({});
  });

  it('accepts every FEATURE_KEY', async () => {
    const all = Object.fromEntries(FEATURE_KEYS.map((k) => [k, true]));
    const res = await adminCaller(adminUserId).admin.setFeatures({ restaurantId: T.restaurantId, features: all });
    expect(FEATURE_KEYS.every((k) => res.features.effective[k])).toBe(true);
  });

  it('an unknown restaurant is NOT_FOUND', async () => {
    await expect(
      adminCaller(adminUserId).admin.setFeatures({
        restaurantId: '00000000-0000-0000-0000-000000000000',
        features: { contracts: true },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('records admin.features with the before and after flags', async () => {
    await db.update(restaurants).set({ settings: { features: { recipes: true } } as never }).where(eq(restaurants.id, T.restaurantId));
    await adminCaller(adminUserId).admin.setFeatures({ restaurantId: T.restaurantId, features: { contracts: true } });
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, T.restaurantId), eq(auditLog.action, 'admin.features')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: adminUserId,
      entityType: 'restaurant',
      entityId: T.restaurantId,
      before: { recipes: true },
      after: { recipes: true, contracts: true },
    });
  });

  it('getRestaurant reports stored, effective and kill-switched flags', async () => {
    await db.update(restaurants).set({ settings: { features: { contracts: true, recovery: true } } as never }).where(eq(restaurants.id, T.restaurantId));
    const prev = process.env.FEATURES_OFF;
    process.env.FEATURES_OFF = 'recovery';
    try {
      const { features } = await adminCaller(adminUserId).admin.getRestaurant({ restaurantId: T.restaurantId });
      expect(features.stored).toEqual({ contracts: true, recovery: true });
      expect(features.all).toBe(false);
      expect(features.effective.contracts).toBe(true);
      expect(features.effective.recovery).toBe(false); // stored on, killed for every tenant
      expect(features.killed).toEqual(['recovery']);
    } finally {
      if (prev === undefined) delete process.env.FEATURES_OFF;
      else process.env.FEATURES_OFF = prev;
    }
  });
});

describe('admin.assignPlan — a trial with an end date', () => {
  beforeEach(async () => {
    await enrolTotp(adminUserId);
  });

  it('Pro trialing for 30 days ends 30 days from now, shown on the restaurant and audited', async () => {
    const before = Date.now();
    const res = await adminCaller(adminUserId).admin.assignPlan({
      restaurantId: T.restaurantId,
      planKey: 'pro',
      status: 'trialing',
      trialDays: 30,
    });
    expect(res.status).toBe('trialing');
    const day = 24 * 60 * 60 * 1000;
    expect(res.trialEndsAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * day);
    expect(res.trialEndsAt!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * day);

    const { subscription } = await adminCaller(adminUserId).admin.getRestaurant({ restaurantId: T.restaurantId });
    expect(subscription).toMatchObject({ planKey: 'pro', status: 'trialing' });
    expect(subscription!.trialEndsAt!.getTime()).toBe(res.trialEndsAt!.getTime());

    const [row] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, T.restaurantId), eq(auditLog.action, 'admin.plan_assigned')));
    expect(row!.after).toMatchObject({ planKey: 'pro', status: 'trialing' });
    expect((row!.after as { trialEndsAt: string }).trialEndsAt).toBe(res.trialEndsAt!.toISOString());
  });

  it('active has no end date', async () => {
    const res = await adminCaller(adminUserId).admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', status: 'active' });
    expect(res.trialEndsAt).toBeNull();
  });
});

describe('admin reads of tenant data are audited (admin.viewed)', () => {
  beforeEach(async () => {
    await enrolTotp(adminUserId);
  });

  const viewed = (restaurantId: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.restaurantId, restaurantId), eq(auditLog.action, 'admin.viewed')));

  it('getRestaurant writes one admin.viewed row for that tenant', async () => {
    await adminCaller(adminUserId).admin.getRestaurant({ restaurantId: T.restaurantId });
    const rows = await viewed(T.restaurantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: adminUserId, entityType: 'restaurant', entityId: T.restaurantId, after: { view: 'detail' } });
  });

  it('listRestaurants writes one admin.viewed row per tenant listed', async () => {
    const U = await seedTenant(db, 'Pilot2');
    await adminCaller(adminUserId).admin.listRestaurants();
    for (const id of [T.restaurantId, U.restaurantId]) {
      const rows = await viewed(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: adminUserId, after: { view: 'list' } });
    }
  });

  it('a refused read (no TOTP) leaves no admin.viewed row', async () => {
    await db.delete(userCredentials).where(eq(userCredentials.userId, adminUserId));
    await expect(adminCaller(adminUserId).admin.getRestaurant({ restaurantId: T.restaurantId })).rejects.toThrow();
    expect(await viewed(T.restaurantId)).toHaveLength(0);
  });

  it('listLeads (no tenant to attribute) logs a structured admin.viewed line', async () => {
    await db.insert(leads).values({ name: 'ליד', phone: '050-0000000', source: 'landing' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // resetDb keeps leads (other files add some): the line counts what was returned.
      const rows = await adminCaller(adminUserId).admin.listLeads();
      expect(rows.length).toBeGreaterThan(0);
      const line = info.mock.calls.map((c) => String(c[0])).find((s) => s.includes('admin.viewed'));
      expect(JSON.parse(line!)).toEqual({ audit: 'admin.viewed', entityType: 'leads', userId: adminUserId, count: rows.length });
    } finally {
      info.mockRestore();
    }
  });
});
