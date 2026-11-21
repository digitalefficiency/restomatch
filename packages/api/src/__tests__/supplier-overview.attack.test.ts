import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/** W2-11 · cross-tenant: restaurant A can neither read B's supplier overview nor see B in its table. */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});
afterAll(async () => {
  await resetDb(db);
});

describe('W2-11 supplier overview — tenant isolation', () => {
  it('a foreign supplierId is NOT_FOUND', async () => {
    await expect(callerFor(A).suppliers.overview({ supplierId: B.supplierId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the vendor table lists only this restaurant’s suppliers', async () => {
    const t = await callerFor(A).suppliers.table({ includeInactive: true });
    expect(t.rows.map((r) => r.supplierId)).toEqual([A.supplierId]);
  });
});
