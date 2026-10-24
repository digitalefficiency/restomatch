import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  goodsReceipts,
  matchRuns,
  restaurants,
  sql,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * DOCK SLIP ATTACK SUITE — receiving.dockSlip on the RLS-enforced app role
 * (`restomatch_app`, no BYPASSRLS), like production.
 *
 *   A — its seeded receipt + invoice (an open PRICE_HIGHER ₪100 on the invoice).
 *   B — another tenant: its flag, receipt, invoice, supplier and owner never reach A.
 *
 * Also pins the "₪ only after the count" rule: a match run from before the
 * receipt was closed never puts ₪ on the slip.
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;

function caller(userId: string, restaurantId: string, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db: appDb, session: { userId, restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const asA = () => caller(A.ownerUserId, A.restaurantId);
/** A real JSON boolean (all:true on, so only a boolean false turns the slip off). */
const setFlag = (t: Tenant, on: boolean) =>
  ownerDb
    .update(restaurants)
    .set({ settings: { features: { all: true, dockSlip: on } } as (typeof restaurants.$inferInsert)['settings'] })
    .where(eq(restaurants.id, t.restaurantId));

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'DA');
  B = await seedTenant(ownerDb, 'DB');
  await setFlag(A, true);
  await setFlag(B, true);
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('receiving.dockSlip under RLS', () => {
  it("A off (boolean false) while B is on ⇒ A gets enabled:false; B's flag never opens A", async () => {
    await setFlag(A, false);
    try {
      expect(await asA().receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId })).toEqual({ enabled: false });
      const b = await caller(B.ownerUserId, B.restaurantId).receiving.dockSlip({ grId: B.grId });
      expect(b.enabled).toBe(true);
    } finally {
      await setFlag(A, true);
    }
  });

  it("B's receipt / invoice ids are NOT_FOUND for A", async () => {
    await expect(asA().receiving.dockSlip({ grId: B.grId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asA().receiving.dockSlip({ grId: A.grId, invoiceId: B.invoiceId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('receipt still open ⇒ quantities only: no ₪ even though a match run exists', async () => {
    const slip = await asA().receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    if (!slip.enabled) throw new Error('flag off');
    expect(slip.engine).toEqual({ receiptClosed: false, ready: false, holdReason: null, totalIls: 0, lines: [] });
  });

  it('closed after its only run (a pre-count run) ⇒ still no ₪; a run after the close ⇒ the engine ₪', async () => {
    await ownerDb.update(goodsReceipts).set({ status: 'completed', updatedAt: new Date() }).where(eq(goodsReceipts.id, A.grId));
    const before = await asA().receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    if (!before.enabled) throw new Error('flag off');
    expect(before.engine).toMatchObject({ receiptClosed: true, ready: false, totalIls: 0, lines: [] });

    // The re-match after the count (receiving.submitReceipt → worker).
    await ownerDb.update(matchRuns).set({ runAt: sql`now() + interval '1 second'` }).where(eq(matchRuns.id, A.matchRunId));
    const after = await asA().receiving.dockSlip({ grId: A.grId, invoiceId: A.invoiceId });
    if (!after.enabled) throw new Error('flag off');
    expect(after.engine.ready).toBe(true);
    expect(after.engine.totalIls).toBe(100);
    expect(after.engine.lines.map((l) => [l.discrepancyId, l.amountIls])).toEqual([[A.discrepancyId, 100]]);
    const json = JSON.stringify(after);
    expect(json).not.toContain(B.invoiceId);
    expect(json).not.toContain(B.discrepancyId);
    expect(json).not.toContain(B.supplierName);
  });

  it("the receiver's name is shown to the receiver only — never another person's", async () => {
    const own = await asA().receiving.dockSlip({ grId: A.grId });
    if (!own.enabled) throw new Error('flag off');
    expect(own.header.receiverName).toBe('Owner DA');
    // A receipt "received by" someone else (here B's owner): no name, not theirs.
    await ownerDb.update(goodsReceipts).set({ receivedBy: B.ownerUserId }).where(eq(goodsReceipts.id, A.grId));
    try {
      const other = await asA().receiving.dockSlip({ grId: A.grId });
      if (!other.enabled) throw new Error('flag off');
      expect(other.header.receiverName).toBeNull();
      expect(JSON.stringify(other)).not.toContain('Owner DB');
    } finally {
      await ownerDb.update(goodsReceipts).set({ receivedBy: A.ownerUserId }).where(eq(goodsReceipts.id, A.grId));
    }
  });
});
