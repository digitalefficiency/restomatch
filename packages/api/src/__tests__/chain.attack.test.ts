import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  applyAuditImmutableRls,
  applyAuthCredentialTables,
  applyCoreTenantRls,
  billingAccounts,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  invoiceLines,
  memberships,
  products,
  restaurants,
  subscriptions,
  suppliers,
  testDbUrl,
  type Database,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { chainScopeOf, currentMonth, type MembershipRow } from '../routers/chain';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * CHAIN ATTACK SUITE — runs the chain router on the RLS-enforced app role
 * (`restomatch_app`, no BYPASSRLS), exactly like production.
 *
 * Topology (one billing account "ACCT" on the chain plan):
 *   A   — owner: userA        (ACCT)   leak ₪100
 *   A2  — owner: userA        (ACCT)   leak ₪40
 *   M   — userA is MANAGER    (ACCT)   leak ₪7     → excluded from A's chain
 *   B   — owner: userB only   (ACCT)   leak ₪90    → userA is not a member
 *   X   — owner: userA        (OTHER account) ₪3   → a different business
 *
 * userA's chain = {A, A2}: ₪140 of ₪200 spend. Nothing of B, M or X may leak
 * into it, and no client-supplied id may reach B.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;

let A: Tenant;
let A2: Tenant;
let M: Tenant;
let B: Tenant;
let X: Tenant;
let acct: string;

function caller(userId: string, restaurantId: string | null, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db: appDb, session: { userId, restaurantId, role } };
  return appRouter.createCaller(ctx);
}
const asA = () => caller(A.ownerUserId, A.restaurantId);

async function setLeak(t: Tenant, delta: string) {
  await ownerDb
    .update(discrepancies)
    .set({ deltaAmount: delta })
    .where(eq(discrepancies.restaurantId, t.restaurantId));
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  await applyAuthCredentialTables(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);

  A = await seedTenant(ownerDb, 'A');
  A2 = await seedTenant(ownerDb, 'A2');
  M = await seedTenant(ownerDb, 'M');
  B = await seedTenant(ownerDb, 'B');
  X = await seedTenant(ownerDb, 'X');

  acct = await attachSubscription(ownerDb, A.restaurantId, { planKey: 'chain', status: 'active' });
  // userA pays for ACCT.
  await ownerDb.update(billingAccounts).set({ ownerUserId: A.ownerUserId }).where(eq(billingAccounts.id, acct));
  for (const t of [A2, M, B]) {
    await ownerDb.update(restaurants).set({ billingAccountId: acct }).where(eq(restaurants.id, t.restaurantId));
  }
  await attachSubscription(ownerDb, X.restaurantId, { planKey: 'chain', status: 'active' });

  await ownerDb.insert(memberships).values([
    { userId: A.ownerUserId, restaurantId: A2.restaurantId, role: 'owner' },
    { userId: A.ownerUserId, restaurantId: M.restaurantId, role: 'manager' },
    { userId: A.ownerUserId, restaurantId: X.restaurantId, role: 'owner' },
  ]);

  await setLeak(A2, '40.00');
  await setLeak(M, '7.00');
  await setLeak(B, '90.00');
  await setLeak(X, '3.00');
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('chain rule (pure)', () => {
  const row = (id: string, role: MembershipRow['role'], acctId: string | null): MembershipRow => ({
    restaurantId: id,
    name: id,
    role,
    billingAccountId: acctId,
  });

  it('owner branches on the active billing account only', () => {
    const rows = [row('a', 'owner', 'k'), row('a2', 'owner', 'k'), row('m', 'manager', 'k'), row('x', 'owner', 'z')];
    expect(chainScopeOf(rows, 'a').branches.map((b) => b.restaurantId).sort()).toEqual(['a', 'a2']);
  });
  it('no billing account ⇒ the active branch alone', () => {
    const rows = [row('a', 'owner', null), row('b', 'owner', null)];
    expect(chainScopeOf(rows, 'a').branches.map((b) => b.restaurantId)).toEqual(['a']);
  });
  it('a manager or a non-member active branch is FORBIDDEN', () => {
    const rows = [row('a', 'owner', 'k'), row('m', 'manager', 'k')];
    expect(() => chainScopeOf(rows, 'm')).toThrow(/owner-only/);
    expect(() => chainScopeOf(rows, 'nope')).toThrow(/owner-only/);
    expect(() => chainScopeOf(rows, null)).toThrow(/owner-only/);
  });
});

describe('chain.branches', () => {
  it('lists only the caller-owned branches of the shared billing account', async () => {
    const res = await asA().chain.branches();
    expect(res.branches.map((b) => b.restaurantId).sort()).toEqual([A.restaurantId, A2.restaurantId].sort());
    expect(res.branches.find((b) => b.isActive)?.restaurantId).toBe(A.restaurantId);
    expect(res.planKey).toBe('chain');
    expect(res.chainEnabled).toBe(true);
    expect(res.branchLimit).toBe(5);
  });

  it('B (same billing account, no shared membership) sees only its own branch', async () => {
    const res = await caller(B.ownerUserId, B.restaurantId).chain.branches();
    expect(res.branches.map((b) => b.restaurantId)).toEqual([B.restaurantId]);
    expect(res.canAddBranch).toBe(false); // not the payer of the shared account
  });

  it('is FORBIDDEN from a manager-only active branch', async () => {
    await expect(caller(A.ownerUserId, M.restaurantId, 'owner').chain.branches()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('a forged session pointing at B (no membership) is FORBIDDEN — DB membership wins', async () => {
    await expect(caller(A.ownerUserId, B.restaurantId, 'owner').chain.branches()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller(A.ownerUserId, B.restaurantId, 'owner').chain.overview()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('chain.overview', () => {
  it('sums A + A2 only (₪140 of ₪200) — nothing of B, M or X', async () => {
    const o = await asA().chain.overview();
    expect(o.branches.map((b) => b.restaurantId).sort()).toEqual([A.restaurantId, A2.restaurantId].sort());
    expect(o.totals.leakIls).toBe(140);
    expect(o.totals.spendIls).toBe(200);
    expect(o.totals.leakPct).toBeCloseTo(0.7, 10);
    expect(o.totals.pendingApprovals).toBe(2);
    expect(o.heatmap).toHaveLength(2);
    expect(o.months).toHaveLength(6);
    expect(o.month).toBe(currentMonth());
    // Per-branch numbers are each branch's own.
    expect(o.branches.find((b) => b.restaurantId === A.restaurantId)?.leakIls).toBe(100);
    expect(o.branches.find((b) => b.restaurantId === A2.restaurantId)?.leakIls).toBe(40);
    expect(o.worstBranchId).toBe(A.restaurantId);
    // Suppliers are only the branches' own rows.
    const supplierNames = o.topSuppliers.map((s) => s.name);
    expect(supplierNames).not.toContain('ספק B');
    expect(supplierNames).not.toContain('ספק M');
    expect(o.topSuppliers.flatMap((s) => s.branchIds).every((id) => id === A.restaurantId || id === A2.restaurantId)).toBe(true);
  });

  it('B owner sees only B even though B shares the billing account', async () => {
    const o = await caller(B.ownerUserId, B.restaurantId).chain.overview();
    expect(o.branches.map((b) => b.restaurantId)).toEqual([B.restaurantId]);
    expect(o.totals.leakIls).toBe(90);
  });

  it('X (another billing account) is its own chain of one', async () => {
    const o = await caller(A.ownerUserId, X.restaurantId).chain.overview();
    expect(o.branches.map((b) => b.restaurantId)).toEqual([X.restaurantId]);
    expect(o.totals.leakIls).toBe(3);
  });

  it('a past month is reported with zero leak; a future month clamps to the current month', async () => {
    const past = await asA().chain.overview({ month: '2020-01' });
    expect(past.month).toBe('2020-01');
    expect(past.totals.leakIls).toBe(0);
    const future = await asA().chain.overview({ month: '2999-12' });
    expect(future.month).toBe(currentMonth());
  });

  it('rejects a malformed month', async () => {
    await expect(asA().chain.overview({ month: "2026-10'; --" })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a single-branch tenant on a non-chain plan gets ENTITLEMENT_REQUIRED:chain', async () => {
    const solo = await seedTenant(ownerDb, 'S');
    await attachSubscription(ownerDb, solo.restaurantId, { planKey: 'pro', status: 'active' });
    await expect(caller(solo.ownerUserId, solo.restaurantId).chain.overview()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'ENTITLEMENT_REQUIRED:chain',
    });
  });
});

describe('chain.overview price disparities', () => {
  // The same supplier (ח.פ of A's supplier) + product "עגבניה A" at ₪10 in A, ₪11 in A2 and ₪30 in B.
  // B shares the billing account but is not A's: its ₪30 must never appear.
  beforeAll(async () => {
    for (const [t, price] of [[A2, '11.00'], [B, '30.00']] as const) {
      await ownerDb.update(products).set({ canonicalName: 'עגבניה A' }).where(eq(products.id, t.productId));
      await ownerDb.update(suppliers).set({ businessId: '512345671' }).where(eq(suppliers.id, t.supplierId));
      await ownerDb
        .update(invoiceLines)
        .set({ unitPriceBilled: price, lineTotal: (Number(price) * 10).toFixed(2) })
        .where(eq(invoiceLines.id, t.invoiceLineId));
    }
  });
  const setFlag = (on: boolean) =>
    ownerDb
      .update(restaurants)
      .set({ settings: (on ? { features: { priceDisparity: true } } : {}) as typeof restaurants.$inferInsert['settings'] })
      .where(eq(restaurants.id, A.restaurantId));

  it('is null while the priceDisparity feature is off', async () => {
    await setFlag(false);
    expect((await asA().chain.overview()).priceDisparities).toBeNull();
  });

  it("compares only the caller's chain branches (A ₪10 vs A2 ₪11) — never B's ₪30", async () => {
    await setFlag(true);
    try {
      const rows = (await asA().chain.overview()).priceDisparities!;
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r.method).toBe('name');
      expect(r.branches.map((b) => b.restaurantId).sort()).toEqual([A.restaurantId, A2.restaurantId].sort());
      expect(r.cheapest).toMatchObject({ restaurantId: A.restaurantId, avgPrice: 10 });
      expect(r.priciest).toMatchObject({ restaurantId: A2.restaurantId, avgPrice: 11 });
      expect(r.impactIls).toBe(10);
      expect(r.lines.every((l) => l.restaurantId !== B.restaurantId)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(B.invoiceId);
    } finally {
      await setFlag(false);
    }
  });
});

describe('chain.overview price disparities exclude billing errors', () => {
  it('an A2 line the engine flagged as PRICE_HIGHER is a leak, not a price gap', async () => {
    await ownerDb
      .update(restaurants)
      .set({ settings: { features: { priceDisparity: true } } as typeof restaurants.$inferInsert['settings'] })
      .where(eq(restaurants.id, A.restaurantId));
    await ownerDb.update(discrepancies).set({ invoiceLineId: A2.invoiceLineId }).where(eq(discrepancies.id, A2.discrepancyId));
    try {
      expect((await asA().chain.overview()).priceDisparities).toEqual([]);
    } finally {
      await ownerDb.update(discrepancies).set({ invoiceLineId: null }).where(eq(discrepancies.id, A2.discrepancyId));
      await ownerDb
        .update(restaurants)
        .set({ settings: {} as typeof restaurants.$inferInsert['settings'] })
        .where(eq(restaurants.id, A.restaurantId));
    }
  });
});

describe('chain.switchTarget', () => {
  it('rejects a branch the caller is not a member of (B), and a random id', async () => {
    await expect(asA().chain.switchTarget({ restaurantId: B.restaurantId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asA().chain.switchTarget({ restaurantId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('accepts any own membership, reporting that membership role', async () => {
    await expect(asA().chain.switchTarget({ restaurantId: M.restaurantId })).resolves.toMatchObject({
      restaurantId: M.restaurantId,
      role: 'manager',
    });
    await expect(asA().chain.switchTarget({ restaurantId: A2.restaurantId })).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('rejects an unauthenticated caller', async () => {
    const anon = appRouter.createCaller({ db: appDb, session: null });
    await expect(anon.chain.switchTarget({ restaurantId: A.restaurantId })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('chain.renameBranch', () => {
  it("cannot rename B or the manager-only branch M; B's name is untouched", async () => {
    await expect(asA().chain.renameBranch({ restaurantId: B.restaurantId, name: 'pwned' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asA().chain.renameBranch({ restaurantId: M.restaurantId, name: 'pwned' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const [b] = await ownerDb.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, B.restaurantId));
    const [m] = await ownerDb.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, M.restaurantId));
    expect(b?.name).toBe('Resto B');
    expect(m?.name).toBe('Resto M');
  });

  it('renames an own chain branch', async () => {
    await asA().chain.renameBranch({ restaurantId: A2.restaurantId, name: 'סניף שני' });
    const [r] = await ownerDb.select({ name: restaurants.name }).from(restaurants).where(eq(restaurants.id, A2.restaurantId));
    expect(r?.name).toBe('סניף שני');
  });
});

describe('chain.addBranch', () => {
  it('opens a branch on the same account, owned by the caller, with copied suppliers + catalog', async () => {
    const res = await asA().chain.addBranch({ name: 'סניף חדש', copyCatalog: true });
    expect(res.copied.suppliers).toBe(1);
    expect(res.copied.products).toBe(1);
    const [r] = await ownerDb.select().from(restaurants).where(eq(restaurants.id, res.restaurantId));
    expect(r?.billingAccountId).toBe(acct);
    const mem = await ownerDb
      .select()
      .from(memberships)
      .where(eq(memberships.restaurantId, res.restaurantId));
    expect(mem).toEqual([expect.objectContaining({ userId: A.ownerUserId, role: 'owner' })]);
    // Copies are the SOURCE branch's rows only — never B's.
    const sups = await ownerDb.select().from(suppliers).where(eq(suppliers.restaurantId, res.restaurantId));
    expect(sups.map((s) => s.name)).toEqual(['ספק A']);
    const branches = await asA().chain.branches();
    expect(branches.branches.map((b) => b.restaurantId)).toContain(res.restaurantId);
  });

  it('enforces the plan branch limit', async () => {
    // A now has 3 owner branches on ACCT; cap the account at 3.
    await ownerDb
      .update(subscriptions)
      .set({ overrides: { limits: { restaurants: 3 } } })
      .where(eq(subscriptions.billingAccountId, acct));
    try {
      await expect(asA().chain.addBranch({ name: 'one too many' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'ENTITLEMENT_REQUIRED:chain',
      });
      expect((await asA().chain.branches()).canAddBranch).toBe(false);
    } finally {
      await ownerDb.update(subscriptions).set({ overrides: {} }).where(eq(subscriptions.billingAccountId, acct));
    }
  });

  it("B's owner (same account, not the payer) cannot bill a new branch to A's account", async () => {
    await expect(caller(B.ownerUserId, B.restaurantId).chain.addBranch({ name: 'free ride' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const rows = await ownerDb.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'free ride'));
    expect(rows).toEqual([]);
  });

  it('the in-transaction recount blocks concurrent adds past the limit', async () => {
    // userA is a member of 4 restaurants on ACCT (A, A2, M, the branch added above): room for exactly 2.
    await ownerDb
      .update(subscriptions)
      .set({ overrides: { limits: { restaurants: 6 } } })
      .where(eq(subscriptions.billingAccountId, acct));
    try {
      const results = await Promise.allSettled(
        ['race 1', 'race 2', 'race 3'].map((name) => asA().chain.addBranch({ name })),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const visible = await ownerDb
        .select({ id: restaurants.id })
        .from(restaurants)
        .innerJoin(memberships, eq(memberships.restaurantId, restaurants.id))
        .where(and(eq(restaurants.billingAccountId, acct), eq(memberships.userId, A.ownerUserId)));
      expect(visible.length).toBeLessThanOrEqual(6);
      expect(ok).toBe(2);
    } finally {
      await ownerDb.update(subscriptions).set({ overrides: {} }).where(eq(subscriptions.billingAccountId, acct));
    }
  });

  it('a restaurant without a billing account (implicit trial) cannot add branches', async () => {
    const t = await seedTenant(ownerDb, 'T');
    await expect(caller(t.ownerUserId, t.restaurantId).chain.addBranch({ name: 'branch 2' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('a manager (active branch M) cannot add a branch to the account', async () => {
    await expect(caller(A.ownerUserId, M.restaurantId, 'manager').chain.addBranch({ name: 'nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const onAcct = await ownerDb
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(and(eq(restaurants.billingAccountId, acct), eq(restaurants.name, 'nope')));
    expect(onAcct).toEqual([]);
  });
});
