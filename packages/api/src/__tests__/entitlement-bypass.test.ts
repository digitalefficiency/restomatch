import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '@restomatch/db';
import { appRouter } from '../index';
import { getEntitlements, getQuota, meterOcrScan, QuotaExceededError } from '../entitlements';
import type { AppContext, Session } from '../context';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * ENTITLEMENT-BYPASS SUITE — the revenue boundary.
 *
 * A paid-tier gate that can be bypassed leaks revenue the way a tenant gate
 * leaks data. This proves the gates hold across every path: the tRPC feature
 * gate, the authoritative worker quota (including concurrent races), expired
 * trials, past_due, and admin overrides.
 */

const TEST_DB_URL =
  testDbUrl();
const db = createDb(TEST_DB_URL);

function caller(tenant: Tenant) {
  const session: Session = {
    userId: tenant.ownerUserId,
    restaurantId: tenant.restaurantId,
    role: 'owner',
  };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

const PERIOD = '2026-06';
const NOW = new Date('2026-06-15T00:00:00Z');

beforeAll(async () => {
  await resetDb(db);
  await seedPlans(db);
});

afterAll(async () => {
  await resetDb(db);
});

describe('feature gate via tRPC (accounting_export, advanced_analytics)', () => {
  let T: Tenant;
  beforeEach(async () => {
    await resetDb(db);
    await seedPlans(db);
    T = await seedTenant(db, 'F');
  });

  it('implicit trial (no billing account) grants paid features', async () => {
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).resolves.toBeDefined();
    await expect(c.owner.leaks()).resolves.toBeDefined();
  });

  it('basic plan (no features) blocks exports and analytics', async () => {
    await attachSubscription(db, T.restaurantId, { planKey: 'basic', status: 'active' });
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(c.owner.suppliers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // KPIs stay on the core plan.
    await expect(c.owner.kpis()).resolves.toBeDefined();
  });

  it('pro plan grants the features', async () => {
    await attachSubscription(db, T.restaurantId, { planKey: 'pro', status: 'active' });
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).resolves.toBeDefined();
    await expect(c.owner.leaks()).resolves.toBeDefined();
  });

  it('admin override adds a feature to a basic plan', async () => {
    await attachSubscription(db, T.restaurantId, {
      planKey: 'basic',
      status: 'active',
      overrides: { features: ['accounting_export'] },
    });
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).resolves.toBeDefined();
    // analytics still blocked (not in the override)
    await expect(c.owner.leaks()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('expired trial revokes all features', async () => {
    await attachSubscription(db, T.restaurantId, {
      planKey: 'pro',
      status: 'trialing',
      trialEndsAt: new Date('2020-01-01T00:00:00Z'),
    });
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('past_due revokes all features', async () => {
    await attachSubscription(db, T.restaurantId, { planKey: 'pro', status: 'past_due' });
    const c = caller(T);
    await expect(
      c.exports.invoicesCsv({ from: '2026-06-01', to: '2026-06-30' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('OCR quota — authoritative worker metering', () => {
  let T: Tenant;
  beforeEach(async () => {
    await resetDb(db);
    await seedPlans(db);
    T = await seedTenant(db, 'Q');
  });

  it('no billing account ⇒ not metered (implicit trial)', async () => {
    const r = await meterOcrScan(db, T.restaurantId, NOW);
    expect(r.metered).toBe(false);
  });

  it('enforces the monthly cap and counts only up to the limit', async () => {
    await attachSubscription(db, T.restaurantId, {
      planKey: 'basic',
      status: 'active',
      overrides: { limits: { invoicesPerMonth: 3, restaurants: 1, seatsPerRestaurant: 5 } },
    });
    // 3 allowed
    for (let i = 0; i < 3; i++) {
      await expect(meterOcrScan(db, T.restaurantId, NOW)).resolves.toMatchObject({ metered: true });
    }
    // 4th blocked
    await expect(meterOcrScan(db, T.restaurantId, NOW)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('is race-safe: N concurrent scans admit at most `limit`', async () => {
    const limit = 5;
    await attachSubscription(db, T.restaurantId, {
      planKey: 'pro',
      status: 'active',
      overrides: { limits: { invoicesPerMonth: limit, restaurants: 1, seatsPerRestaurant: 10 } },
    });
    const attempts = 20;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () => meterOcrScan(db, T.restaurantId, NOW)),
    );
    const allowed = results.filter((r) => r.status === 'fulfilled').length;
    const blocked = results.filter((r) => r.status === 'rejected').length;
    expect(allowed).toBe(limit);
    expect(blocked).toBe(attempts - limit);
  });

  it('expired trial blocks metering entirely', async () => {
    await attachSubscription(db, T.restaurantId, {
      planKey: 'pro',
      status: 'trialing',
      trialEndsAt: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(meterOcrScan(db, T.restaurantId, NOW)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('getQuota reflects recorded usage for the web pre-check', async () => {
    await attachSubscription(db, T.restaurantId, {
      planKey: 'pro',
      status: 'active',
      overrides: { limits: { invoicesPerMonth: 10, restaurants: 1, seatsPerRestaurant: 10 } },
    });
    await meterOcrScan(db, T.restaurantId, NOW);
    await meterOcrScan(db, T.restaurantId, NOW);
    const q = await getQuota(db, T.restaurantId, 'ocr_scans', NOW);
    expect(q).toMatchObject({ metered: true, used: 2, limit: 10, remaining: 8, withinLimit: true });
  });
});

describe('getEntitlements resolution', () => {
  it('reads plan + status + overrides for a subscribed account', async () => {
    await resetDb(db);
    await seedPlans(db);
    const T = await seedTenant(db, 'E');
    await attachSubscription(db, T.restaurantId, {
      planKey: 'pro',
      status: 'active',
      overrides: { limits: { invoicesPerMonth: 999 } },
    });
    const ent = await getEntitlements(db, T.restaurantId, NOW);
    expect(ent.planKey).toBe('pro');
    expect(ent.active).toBe(true);
    expect(ent.limits.invoicesPerMonth).toBe(999); // override applied
    expect(ent.features).toContain('accounting_export');
  });

  it('falls back to implicit trial without a subscription', async () => {
    await resetDb(db);
    await seedPlans(db);
    const T = await seedTenant(db, 'E2');
    const ent = await getEntitlements(db, T.restaurantId, NOW);
    expect(ent.planKey).toBe('trial');
    expect(ent.active).toBe(true);
    expect(ent.billingAccountId).toBeNull();
  });
});

// reference PERIOD so an unused-var lint never trips while documenting intent
void PERIOD;
