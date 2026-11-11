import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { callerFor, db, FINANCE } from './owner-test-helpers';

let A: Tenant;
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterAll(async () => resetDb(db));

describe('owner.kpis serves money only to deciders (W2-09c)', () => {
  it('owner, manager and bookkeeper get the ₪ fields', async () => {
    for (const role of FINANCE) {
      const k = await callerFor(A, role).owner.kpis();
      expect([role, typeof k.monthPotentialLossIls, typeof k.monthSavingsCapturedIls]).toEqual([role, 'number', 'number']);
    }
  });

  it('receiver and chef get the counts, and null (never ₪0) for money', async () => {
    const owner = await callerFor(A, 'owner').owner.kpis();
    for (const role of ['receiver', 'chef'] as const) {
      const k = await callerFor(A, role).owner.kpis();
      expect([role, k.monthPotentialLossIls, k.monthSavingsCapturedIls]).toEqual([role, null, null]);
      expect(k.pendingApprovalsCount).toBe(owner.pendingApprovalsCount);
      expect(k.weekCleanMatchPct).toEqual(owner.weekCleanMatchPct);
    }
  });
});
