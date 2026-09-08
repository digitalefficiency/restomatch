import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const url = testDbUrl();
const db = createDb(url);

let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('settings router', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
  });
  afterAll(async () => {
    await resetDb(db);
  });
  beforeEach(async () => {
    // Reset both restaurants' settings to empty between cases.
    await db.update(restaurants).set({ settings: {} });
  });

  it('get returns the empty default before any update', async () => {
    const settings = await callerFor(A).settings.get();
    expect(settings).toEqual({});
  });

  it('update merges nested tolerances and approvalThresholds without blanking siblings', async () => {
    const caller = callerFor(A);
    await caller.settings.update({
      tolerances: { pricePercent: 0.05, priceAbsolute: 7 },
      approvalThresholds: { largeInvoiceWithoutPo: 8000 },
      ocrReviewThreshold: 0.9,
    });
    // Second update touches only one tolerance key — the others must survive.
    const out = await caller.settings.update({ tolerances: { qtyPercent: 0.06 } });
    expect(out.tolerances).toMatchObject({ pricePercent: 0.05, priceAbsolute: 7, qtyPercent: 0.06 });
    expect(out.approvalThresholds?.largeInvoiceWithoutPo).toBe(8000);
    expect(out.ocrReviewThreshold).toBe(0.9);
  });

  it('preserves unrelated settings keys (baselineWindowDays) on update', async () => {
    await db
      .update(restaurants)
      .set({ settings: { baselineWindowDays: 30 } })
      .where(eq(restaurants.id, A.restaurantId));
    const out = await callerFor(A).settings.update({ ocrReviewThreshold: 0.7 });
    expect(out.baselineWindowDays).toBe(30);
    expect(out.ocrReviewThreshold).toBe(0.7);
  });

  it('rejects an out-of-range fraction', async () => {
    await expect(
      callerFor(A).settings.update({ ocrReviewThreshold: 1.5 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('update is owner-only — a manager is FORBIDDEN', async () => {
    await expect(
      callerFor(A, 'manager').settings.update({ ocrReviewThreshold: 0.5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('get is allowed for a non-owner member (manager)', async () => {
    await expect(callerFor(A, 'manager').settings.get()).resolves.toBeDefined();
  });

  it('scopes writes to the caller restaurant', async () => {
    await callerFor(A).settings.update({ ocrReviewThreshold: 0.6 });
    const settingsB = await callerFor(B).settings.get();
    expect(settingsB.ocrReviewThreshold).toBeUndefined();
  });
});
