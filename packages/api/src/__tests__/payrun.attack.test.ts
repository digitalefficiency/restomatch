import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  invoices,
  matchRuns,
  restaurants,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { claimableLines, sumClaims } from '../lib/claims';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * PAY RUN ATTACK SUITE — payRun.month on the RLS-enforced app role
 * (`restomatch_app`, no BYPASSRLS), like production.
 *
 *   A — flag payRun on; its seeded invoice has an open PRICE_HIGHER ₪100.
 *   B — another tenant with its own invoice + finding: never in A's payload.
 *
 * Also pins the money contract: the pay run's ₪ equal the credit letters'
 * (claimableLines over owner.leakBreakdown) for the same month, to the agora.
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
const asA = (role: Session['role'] = 'owner') => caller(A.ownerUserId, A.restaurantId, role);
const setFlag = (t: Tenant, on: boolean) =>
  ownerDb
    .update(restaurants)
    .set({ settings: (on ? { features: { payRun: true } } : {}) as typeof restaurants.$inferInsert['settings'] })
    .where(eq(restaurants.id, t.restaurantId));

/** Σ letters' ₪ for the month, computed exactly like /dashboard/leaks/claims. */
async function lettersTotal(c: ReturnType<typeof asA>, monthOffset: 0 | -1 = 0) {
  const rows = await c.owner.leakBreakdown({ monthOffset, limit: 200 });
  return Math.round(rows.reduce((s, inv) => s + sumClaims(claimableLines(inv)) * 100, 0)) / 100;
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'PA');
  B = await seedTenant(ownerDb, 'PB');
  await setFlag(A, true);
  await setFlag(B, true);
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('payRun.month', () => {
  it('flag off ⇒ enabled:false, nothing listed', async () => {
    await setFlag(A, false);
    try {
      expect(await asA().payRun.month()).toMatchObject({ enabled: false, suppliers: [], totals: { invoices: 0 } });
      expect(await asA().payRun.enabled()).toBe(false);
      // B's flag is on — A never reads it.
      expect(await caller(B.ownerUserId, B.restaurantId).payRun.enabled()).toBe(true);
    } finally {
      await setFlag(A, true);
    }
  });

  it("lists only A's invoices — B's invoice, supplier and findings never appear", async () => {
    const r = await asA().payRun.month();
    expect(r.enabled).toBe(true);
    const ids = r.suppliers.flatMap((s) => s.invoices.map((i) => i.invoiceId));
    expect(ids).toEqual([A.invoiceId]);
    const json = JSON.stringify(r);
    expect(json).not.toContain(B.invoiceId);
    expect(json).not.toContain(B.discrepancyId);
    expect(json).not.toContain(B.supplierName);
  });

  it('an open finding holds the invoice; its ₪ equal the credit letters to the agora', async () => {
    const r = await asA().payRun.month();
    const inv = r.suppliers[0]!.invoices[0]!;
    expect(inv).toMatchObject({ status: 'hold', pendingIls: 100, creditIls: 0, totalInclVat: 117 });
    expect(inv.claims.map((c) => [c.discrepancyId, c.amount, c.basis])).toEqual([[A.discrepancyId, 100, 'excl']]);
    expect(r.totals.pendingIls + r.totals.creditIls).toBe(await lettersTotal(asA()));
    expect(r.totals).toMatchObject({ invoices: 1, holdIls: 117, payIls: 0, claimIls: 0 });
  });

  it('accepted claim ⇒ "ask for a credit" of exactly the letters amount', async () => {
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, A.discrepancyId));
    try {
      const r = await asA().payRun.month();
      const inv = r.suppliers[0]!.invoices[0]!;
      expect(inv).toMatchObject({ status: 'claim', creditIls: 100, pendingIls: 0 });
      expect(r.totals.creditIls).toBe(await lettersTotal(asA()));
      expect(r.totals.claimIls).toBe(117);
    } finally {
      await ownerDb.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, A.discrepancyId));
    }
  });

  it('a waived finding leaves the invoice payable, with nothing to claim', async () => {
    await ownerDb.update(discrepancies).set({ resolutionStatus: 'rejected' }).where(eq(discrepancies.id, A.discrepancyId));
    try {
      const inv = (await asA().payRun.month()).suppliers[0]!.invoices[0]!;
      expect(inv).toMatchObject({ status: 'pay', claims: [], creditIls: 0, pendingIls: 0 });
      expect(await lettersTotal(asA())).toBe(0);
    } finally {
      await ownerDb.update(discrepancies).set({ resolutionStatus: 'open' }).where(eq(discrepancies.id, A.discrepancyId));
    }
  });

  it('an invoice marked paid drops out; an unchecked invoice (no match run) is not listed', async () => {
    await ownerDb.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, A.invoiceId));
    try {
      expect((await asA().payRun.month()).totals.invoices).toBe(0);
    } finally {
      await ownerDb.update(invoices).set({ status: 'matched' }).where(eq(invoices.id, A.invoiceId));
    }
    await ownerDb.update(matchRuns).set({ invoiceId: null as unknown as string }).where(eq(matchRuns.id, A.matchRunId)).catch(() => {});
    const [mr] = await ownerDb.select({ invoiceId: matchRuns.invoiceId }).from(matchRuns).where(eq(matchRuns.id, A.matchRunId));
    if (mr?.invoiceId === null) {
      try {
        expect((await asA().payRun.month()).totals.invoices).toBe(0);
      } finally {
        await ownerDb.update(matchRuns).set({ invoiceId: A.invoiceId }).where(eq(matchRuns.id, A.matchRunId));
      }
    }
  });

  it('manager and bookkeeper may read it; receiver and chef are FORBIDDEN', async () => {
    await expect(asA('manager').payRun.month()).resolves.toMatchObject({ enabled: true });
    await expect(asA('bookkeeper').payRun.month()).resolves.toMatchObject({ enabled: true });
    for (const role of ['receiver', 'chef'] as const) {
      await expect(asA(role).payRun.month()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(asA(role).payRun.enabled()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('rejects any month but this one and the previous', async () => {
    await expect(asA().payRun.month({ monthOffset: -2 as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(asA().payRun.month({ monthOffset: -1 })).resolves.toMatchObject({ enabled: true, totals: { invoices: 0 } });
  });
});
