import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  matchRuns,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * W2-02: the bookkeeper corrects OCR and re-matches (capability invoice.correct);
 * runForInvoice returns the gap before → after in integer agorot. The receiver
 * and chef are refused; a foreign invoice is NOT_FOUND with no run created.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
const callerOf = (t: Tenant, role: 'owner' | 'manager' | 'bookkeeper' | 'receiver' | 'chef' = 'owner') =>
  appRouter.createCaller({ db: appDb, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } });

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'CA');
  B = await seedTenant(ownerDb, 'CB');
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('match.runForInvoice (W2-02: invoice.correct + before/after)', () => {
  it('the bookkeeper edits a line to the PO price, re-matches, and gets {before, after} in agorot', async () => {
    const bk = callerOf(A, 'bookkeeper');
    const before = await bk.invoices.detail({ invoiceId: A.invoiceId });
    expect(before.gapAgorot).toBe(10000);
    // The PO expects ₪8.50 × 10; correct the billed ₪10.00 to ₪8.50 (owner path: receiving.updateInvoiceLine is W2-05's).
    await callerOf(A, 'owner').receiving.updateInvoiceLine({ lineId: A.invoiceLineId, patch: { unitPriceBilled: 8.5, lineTotal: 85 } });
    const r = await bk.match.runForInvoice({ invoiceId: A.invoiceId });
    expect(r.before).toBe(10000);
    expect(Number.isInteger(r.after)).toBe(true);
    // after = the gap the register and the cockpit now show (the persisted run, G-05 leakIls).
    expect(r.after).toBe((await bk.invoices.detail({ invoiceId: A.invoiceId })).gapAgorot);
    expect(r.matchRunId).not.toBeNull();
  });

  it('the receiver and chef are refused', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerOf(A, role).match.runForInvoice({ invoiceId: A.invoiceId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it("A re-matching B's invoice → NOT_FOUND, no run for A", async () => {
    await expect(callerOf(A, 'bookkeeper').match.runForInvoice({ invoiceId: B.invoiceId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const runs = await ownerDb.select({ id: matchRuns.id }).from(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    expect(runs.every((r) => r.id)).toBe(true);
    const bRuns = await ownerDb.select({ inv: matchRuns.invoiceId }).from(matchRuns).where(eq(matchRuns.restaurantId, A.restaurantId));
    expect(bRuns.some((r) => r.inv === B.invoiceId)).toBe(false);
  });
});
