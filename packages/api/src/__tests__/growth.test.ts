import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCoreTenantRls,
  createDb,
  ensureRlsAppRole,
  eq,
  memberships,
  PLAN_SEED,
  referralCodes,
  referralRedemptions,
  restaurants,
  sql,
  withRestaurant,
  type Database,
  type RestaurantSettings,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { creditReferralRedemption, growthPricingPublicEnabled } from '../routers/growth';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * Growth (S15): feature flag, public pricing gate, referral crediting, and the
 * DATABASE-level RLS backstop for referral_codes / referral_redemptions (raw SQL
 * as the non-owner restomatch_app role — the app layer bypassed entirely).
 */
const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
let appDb: Database;
let A: Tenant;
let B: Tenant;
let C: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner', db: Database = ownerDb) {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function enableGrowth(t: Tenant) {
  await ownerDb
    .update(restaurants)
    .set({ settings: { features: { growth: true } } as unknown as RestaurantSettings })
    .where(eq(restaurants.id, t.restaurantId));
}

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'A');
  B = await seedTenant(ownerDb, 'B');
  C = await seedTenant(ownerDb, 'C');
});

afterAll(async () => {
  await resetDb(ownerDb);
});

describe('feature flag', () => {
  it('every referral procedure is FORBIDDEN/FEATURE_DISABLED while `growth` is off', async () => {
    const caller = callerFor(C);
    for (const call of [
      () => caller.growth.myReferral(),
      () => caller.growth.referralStats(),
      () => caller.growth.redeemReferral({ code: 'ABCDEFGH' }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        cause: { appCode: 'FEATURE_DISABLED' },
      });
    }
  });

  it('the kill-switch wins over a tenant opt-in', async () => {
    await enableGrowth(C);
    process.env.FEATURES_OFF = 'growth';
    try {
      await expect(callerFor(C).growth.myReferral()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      delete process.env.FEATURES_OFF;
      await ownerDb.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, C.restaurantId));
    }
  });

  it('role gate: receivers cannot read or create referral codes', async () => {
    await enableGrowth(A);
    await expect(callerFor(A, 'receiver').growth.myReferral()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A, 'manager').growth.redeemReferral({ code: 'ABCDEFGH' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('public pricing gate', () => {
  it('is off unless GROWTH_PRICING_PUBLIC=1, and the kill-switch wins', () => {
    expect(growthPricingPublicEnabled({})).toBe(false);
    expect(growthPricingPublicEnabled({ GROWTH_PRICING_PUBLIC: '1' })).toBe(true);
    expect(growthPricingPublicEnabled({ GROWTH_PRICING_PUBLIC: '1', FEATURES_OFF: 'all' })).toBe(false);
    expect(growthPricingPublicEnabled({ GROWTH_PRICING_PUBLIC: '1', FEATURES_OFF: 'growth' })).toBe(false);
  });

  it('growth.pricing returns {enabled:false} by default and agorot-exact quotes when on', async () => {
    const anon = appRouter.createCaller({ db: ownerDb, session: null });
    await expect(anon.growth.pricing()).resolves.toEqual({ enabled: false });
    process.env.GROWTH_PRICING_PUBLIC = '1';
    try {
      const q = await anon.growth.pricing({ cycle: 'annual', branches: 7 });
      if (!q.enabled) throw new Error('expected enabled');
      const byKey = Object.fromEntries(q.plans.map((p) => [p.key, p]));
      // Existing list prices are unchanged …
      expect(PLAN_SEED.basic.priceAgorotMonthly).toBe(34_900);
      expect(PLAN_SEED.pro.priceAgorotMonthly).toBe(59_000);
      expect(PLAN_SEED.chain.priceAgorotMonthly).toBe(149_000);
      expect(byKey.basic).toMatchObject({ monthlyAgorot: 34_900, chargeAgorot: 349_000, perMonthDisplayAgorot: 29_083 });
      expect(byKey.pro).toMatchObject({ monthlyAgorot: 59_000, chargeAgorot: 590_000, perMonthDisplayAgorot: 49_167 });
      // … chain at 7 branches = 149,000 + 2 × 29,800.
      expect(byKey.chain).toMatchObject({
        branches: 7,
        perBranchAgorot: 29_800,
        monthlyAgorot: 208_600,
        chargeAgorot: 2_086_000,
        perMonthDisplayAgorot: 173_833,
      });
      expect(byKey.trial).toMatchObject({ monthlyAgorot: 0, chargeAgorot: 0 });
    } finally {
      delete process.env.GROWTH_PRICING_PUBLIC;
    }
  });
});

describe('redeem + credit (one month free for both sides)', () => {
  it('credits each side its own monthly price, once', async () => {
    await enableGrowth(A);
    await enableGrowth(B);
    await attachSubscription(ownerDb, A.restaurantId, { planKey: 'pro', status: 'active' });
    await attachSubscription(ownerDb, B.restaurantId, { planKey: 'basic', status: 'active' });
    const { code } = await callerFor(A).growth.myReferral();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    await callerFor(B).growth.redeemReferral({ code });
    const [row] = await ownerDb
      .select()
      .from(referralRedemptions)
      .where(eq(referralRedemptions.referredRestaurantId, B.restaurantId));
    expect(row).toMatchObject({ status: 'pending', creditAgorotReferrer: null, creditAgorotReferred: null });

    const credited = await creditReferralRedemption(ownerDb, row!.id);
    expect(credited).toMatchObject({ status: 'credited', creditAgorotReferrer: 59_000, creditAgorotReferred: 34_900 });
    // Idempotent.
    const again = await creditReferralRedemption(ownerDb, row!.id);
    expect(again).toMatchObject({ creditAgorotReferrer: 59_000, creditAgorotReferred: 34_900 });

    expect(await callerFor(A).growth.referralStats()).toMatchObject({
      referred: 1,
      credited: 1,
      earnedAgorot: 59_000,
      redeemed: null,
    });
    expect((await callerFor(B).growth.referralStats()).redeemed).toEqual({ status: 'credited', creditAgorot: 34_900 });
  });

  it('works end to end on the RLS app role (security-definer code lookup)', async () => {
    await enableGrowth(C);
    const codeA = (await callerFor(A, 'owner', appDb).growth.myReferral()).code;
    await expect(callerFor(C, 'owner', appDb).growth.redeemReferral({ code: codeA })).resolves.toMatchObject({
      ok: true,
    });
    const stats = await callerFor(A, 'owner', appDb).growth.referralStats();
    expect(stats.referred).toBe(2);
  });
});

describe('RLS backstop (raw SQL as restomatch_app)', () => {
  it('a tenant sees only its own referral code', async () => {
    const rows = await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.select({ restaurantId: referralCodes.restaurantId }).from(referralCodes),
    );
    expect(rows.every((r) => r.restaurantId === B.restaurantId)).toBe(true);
    expect(await appDb.select().from(referralCodes)).toHaveLength(0); // no GUC ⇒ nothing
  });

  it('a redemption is visible only to its referrer and referred', async () => {
    // A↔B and A↔C exist. B sees only A↔B; C sees only A↔C.
    const seenByB = await withRestaurant(appDb, B.restaurantId, (tx) => tx.select().from(referralRedemptions));
    expect(seenByB.map((r) => r.referredRestaurantId)).toEqual([B.restaurantId]);
    const seenByC = await withRestaurant(appDb, C.restaurantId, (tx) => tx.select().from(referralRedemptions));
    expect(seenByC.map((r) => r.referredRestaurantId)).toEqual([C.restaurantId]);
    const seenByA = await withRestaurant(appDb, A.restaurantId, (tx) => tx.select().from(referralRedemptions));
    expect(seenByA).toHaveLength(2);
  });

  it('cannot forge a redemption for another tenant, a credited row, or a wrong referrer', async () => {
    const [codeRowA] = await ownerDb.select().from(referralCodes).where(eq(referralCodes.restaurantId, A.restaurantId));
    // B inserts as if C were the referred side → rejected by WITH CHECK.
    await expect(
      withRestaurant(appDb, B.restaurantId, (tx) =>
        tx.insert(referralRedemptions).values({
          code: codeRowA!.code,
          referrerRestaurantId: A.restaurantId,
          referredRestaurantId: C.restaurantId,
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // A fresh tenant D tries to mint itself a pre-credited row → rejected.
    const D = await seedTenant(ownerDb, 'D');
    await expect(
      withRestaurant(appDb, D.restaurantId, (tx) =>
        tx.insert(referralRedemptions).values({
          code: codeRowA!.code,
          referrerRestaurantId: A.restaurantId,
          referredRestaurantId: D.restaurantId,
          status: 'credited',
          creditAgorotReferrer: 1,
          creditAgorotReferred: 1_000_000,
          creditedAt: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // … or names a referrer the code does not belong to.
    await expect(
      withRestaurant(appDb, D.restaurantId, (tx) =>
        tx.insert(referralRedemptions).values({
          code: codeRowA!.code,
          referrerRestaurantId: B.restaurantId,
          referredRestaurantId: D.restaurantId,
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot credit or delete a redemption (no UPDATE/DELETE path)', async () => {
    const updated = await withRestaurant(appDb, A.restaurantId, (tx) =>
      tx
        .update(referralRedemptions)
        .set({ creditAgorotReferrer: 999_999 })
        .where(eq(referralRedemptions.referrerRestaurantId, A.restaurantId))
        .returning(),
    ).catch((err: { code?: string }) => err);
    // Either a privilege error or zero rows touched — never a write.
    if (Array.isArray(updated)) expect(updated).toHaveLength(0);
    else expect(updated.code).toBe('42501');
    const rows = await ownerDb
      .select({ c: referralRedemptions.creditAgorotReferrer })
      .from(referralRedemptions)
      .where(eq(referralRedemptions.referredRestaurantId, B.restaurantId));
    expect(rows[0]?.c).toBe(59_000);
  });

  it('the code resolver reveals only an id, never another tenant’s rows', async () => {
    const [codeRowA] = await ownerDb.select().from(referralCodes).where(eq(referralCodes.restaurantId, A.restaurantId));
    const res = (await withRestaurant(appDb, B.restaurantId, (tx) =>
      tx.execute(sql`select app.resolve_referral_code(${codeRowA!.code}) as id`),
    )) as unknown as Array<{ id: string }>;
    expect(res[0]?.id).toBe(A.restaurantId);
  });
});

describe('referral anti-abuse (refuter findings)', () => {
  it('an owner cannot refer their own second restaurant, and two restaurants cannot refer each other', async () => {
    const D = await seedTenant(ownerDb, 'AbuseD');
    const E = await seedTenant(ownerDb, 'AbuseE');
    const F = await seedTenant(ownerDb, 'AbuseF');
    const G = await seedTenant(ownerDb, 'AbuseG');
    for (const t of [D, E, F, G]) await enableGrowth(t);

    // D's owner opens a second restaurant (E) and tries to redeem D's code there.
    await ownerDb.insert(memberships).values({ userId: D.ownerUserId, restaurantId: E.restaurantId, role: 'owner' });
    const { code: codeD } = await callerFor(D).growth.myReferral();
    const asDOwnerInE = appRouter.createCaller({
      db: ownerDb,
      session: { userId: D.ownerUserId, restaurantId: E.restaurantId, role: 'owner' },
    });
    await expect(asDOwnerInE.growth.redeemReferral({ code: codeD })).rejects.toMatchObject({
      cause: { appCode: 'growth.referralSelf' },
    });

    // F redeems G's code; G may not then redeem F's (an A↔B swap).
    const { code: codeG } = await callerFor(G).growth.myReferral();
    const { code: codeF } = await callerFor(F).growth.myReferral();
    await expect(callerFor(F).growth.redeemReferral({ code: codeG })).resolves.toMatchObject({ ok: true });
    await expect(callerFor(G).growth.redeemReferral({ code: codeF })).rejects.toMatchObject({
      cause: { appCode: 'growth.referralSelf' },
    });
  });
});
