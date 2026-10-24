import { testDbUrl } from '@restomatch/db';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, eq, restaurants } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** Flag `supplierLeakCard` reaches the supplier page through suppliers.get (UI-only feature). */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function setFeatures(features: Record<string, boolean>) {
  await db.update(restaurants).set({ settings: { features } } as never).where(eq(restaurants.id, A.restaurantId));
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterEach(() => {
  delete process.env.FEATURES_OFF;
});
afterAll(async () => {
  await resetDb(db);
});

describe('suppliers.get → leakCardEnabled', () => {
  it('is off by default and the supplier row is unchanged', async () => {
    const s = await callerFor(A).suppliers.get({ supplierId: A.supplierId });
    expect(s.leakCardEnabled).toBe(false);
    expect(s.id).toBe(A.supplierId);
  });

  it('follows the flag and features.all', async () => {
    await setFeatures({ supplierLeakCard: true });
    expect((await callerFor(A).suppliers.get({ supplierId: A.supplierId })).leakCardEnabled).toBe(true);
    await setFeatures({ all: true });
    expect((await callerFor(A).suppliers.get({ supplierId: A.supplierId })).leakCardEnabled).toBe(true);
    await setFeatures({ all: true, supplierLeakCard: false });
    expect((await callerFor(A).suppliers.get({ supplierId: A.supplierId })).leakCardEnabled).toBe(false);
  });

  it('the FEATURES_OFF kill-switch wins', async () => {
    await setFeatures({ all: true });
    process.env.FEATURES_OFF = 'supplierLeakCard';
    expect((await callerFor(A).suppliers.get({ supplierId: A.supplierId })).leakCardEnabled).toBe(false);
  });
});
