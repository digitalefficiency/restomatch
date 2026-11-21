import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  createDb,
  eq,
  priceAlertThresholds,
  priceAlerts,
  priceHistory,
  restaurants,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import {
  alertTone,
  medianPrice,
  monthlyImpactAgorot,
  PRICE_ALERT_T2_FLOOR_ILS,
} from '../priceAlerts/impact';
import { priceAlertReasonsOn } from '../priceAlerts/reasons';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-12 price-alert impact (≈₪/month), the T2 rule, previewThreshold, dismiss-with-reason + reopen. */

describe('monthlyImpactAgorot (pure, integer agorot)', () => {
  it('(end − start) × 90-day qty ÷ 3 with ONE half-up rounding', () => {
    expect(monthlyImpactAgorot('6.2000', '7.3400', 100)).toBe(3800); // 1.14 × 100 / 3 = ₪38.00
    expect(monthlyImpactAgorot(6.2, 7.32, 100)).toBe(3733); // 112 / 3 = 37.333… → 3733
    expect(monthlyImpactAgorot(10, 10.005, 1)).toBe(0); // 0.005 / 3 = 0.1667 agorot → 0
    expect(monthlyImpactAgorot(10, 10.015, 1)).toBe(1); // 0.5 agorot exactly → half-up → 1
    expect(monthlyImpactAgorot(0.1, 0.3, 0.001)).toBe(0);
    // Floating point would drift here; the bigint path stays exact.
    expect(monthlyImpactAgorot('0.1000', '0.3000', '450')).toBe(3000);
  });

  it('is 0 for a fall or without volume', () => {
    expect(monthlyImpactAgorot(7, 6, 100)).toBe(0);
    expect(monthlyImpactAgorot(6, 7, 0)).toBe(0);
  });

  it('median of the 4-dp prices', () => {
    expect(medianPrice(['6.2', '7.3', '7.32'])).toBe(7.3);
    expect(medianPrice([1, 2])).toBe(1.5);
    expect(medianPrice([])).toBeNull();
  });
});

describe('alertTone — T2 only at ≥ 3 % AND ≥ ₪50/month', () => {
  it('the boundaries: 2.9 % / 3 % and ₪49.99 / ₪50', () => {
    expect(PRICE_ALERT_T2_FLOOR_ILS).toBe(50);
    expect(alertTone('0.0300', 5000)).toBe('t2');
    expect(alertTone('0.0290', 5000)).toBe('t4');
    expect(alertTone('0.0300', 4999)).toBe('t4');
    expect(alertTone(0.18, 3800)).toBe('t4'); // the lab tomato: +18 % but ≈₪38/month
    expect(alertTone(0.18, 21_200)).toBe('t2');
  });
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const caller = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db
      .update(restaurants)
      .set({ settings: { features: { all: true } } as RestaurantSettings })
      .where(eq(restaurants.id, t.restaurantId));
  }
});

beforeEach(async () => {
  await db.delete(priceAlerts);
  await db.delete(priceAlertThresholds);
  await db.delete(priceHistory);
  delete process.env.PRICE_ALERT_REASONS;
  // A rise of ~+18 % over the last 3 weeks at A's supplier.
  for (const [d, p] of [[20, '6.20'], [16, '6.20'], [8, '7.30'], [4, '7.32'], [1, '7.34']] as const) {
    await db.insert(priceHistory).values({
      restaurantId: A.restaurantId,
      productId: A.productId,
      supplierId: A.supplierId,
      observedAt: daysAgo(d),
      unitPrice: p,
      qty: '20',
    });
  }
});

afterAll(async () => {
  delete process.env.PRICE_ALERT_REASONS;
  await resetDb(db);
});

async function openAlert(t: Tenant) {
  const [a] = await db
    .insert(priceAlerts)
    .values({
      restaurantId: t.restaurantId,
      productId: t.productId,
      supplierId: t.supplierId,
      windowDays: 21,
      thresholdPct: '0.1000',
      startPrice: '6.2000',
      endPrice: '7.3400',
      pctChange: '0.1806',
      startAt: daysAgo(20),
      endAt: daysAgo(1),
      observations: 5,
      dedupeKey: `k:${t.restaurantId}:${Math.random()}`,
    })
    .returning();
  return a!.id;
}

describe('priceAlerts.previewThreshold (W2-12)', () => {
  it('counts the series that would alert in 90 days and writes nothing', async () => {
    const c = caller(A, 'bookkeeper');
    const loose = await c.priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.1, windowDays: 21 });
    expect(loose).toEqual({ count: 1, series: 1 });
    const strict = await c.priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.5, windowDays: 21 });
    expect(strict.count).toBe(0);
    expect(await db.select().from(priceAlerts)).toHaveLength(0);
    expect(await db.select().from(priceAlertThresholds)).toHaveLength(0);
  });

  it("is scoped to the caller's restaurant (B sees 0) and rejects a foreign supplier", async () => {
    const b = await caller(B).priceAlerts.previewThreshold({ supplierId: null, category: null, thresholdPct: 0.1, windowDays: 21 });
    expect(b.count).toBe(0);
    await expect(
      caller(B).priceAlerts.previewThreshold({ supplierId: A.supplierId, category: null, thresholdPct: 0.1, windowDays: 21 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('priceAlerts.dismiss with reason + reopen (W2-12)', () => {
  it('flag off (default): the reason is accepted but not recorded; reopen restores the open alert', async () => {
    expect(priceAlertReasonsOn()).toBe(false);
    const id = await openAlert(A);
    const c = caller(A, 'manager');
    await c.priceAlerts.dismiss({ id, reason: 'one_off' });
    let [row] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, id));
    expect(row).toMatchObject({ status: 'dismissed' });
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, id))).length).toBe(0);
    await c.priceAlerts.reopen({ id });
    [row] = await db.select().from(priceAlerts).where(eq(priceAlerts.id, id));
    expect(row).toMatchObject({ status: 'open', dismissedAt: null, dismissedBy: null });
    // Reopening an open alert is NOT_FOUND (nothing to undo).
    await expect(c.priceAlerts.reopen({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('flag on: the reason lands in the audit row', async () => {
    process.env.PRICE_ALERT_REASONS = '1';
    const id = await openAlert(A);
    await caller(A, 'manager').priceAlerts.dismiss({ id, reason: 'new_agreed_price' });
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ reason: 'new_agreed_price' });
  });

  it('an unknown reason is rejected', async () => {
    const id = await openAlert(A);
    await expect(
      caller(A, 'manager').priceAlerts.dismiss({ id, reason: 'because' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
