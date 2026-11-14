/**
 * W3-07a · settings.planUsage — read-only plan & usage, tenant-isolated.
 * A and B sit on different plans with different members and usage; each sees
 * only its own. Kitchen / dock roles never see it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, eq, memberships, restaurants, testDbUrl, usageCounters, users } from '@restomatch/db';
import { appRouter } from '../index';
import { usagePeriod } from '../entitlements';
import type { AppContext, Session } from '../context';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
let A2: Tenant;

function callerFor(t: Tenant, role: Session['role'], userId = t.ownerUserId) {
  const session: Session = { userId, restaurantId: t.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('W3-07a settings.planUsage: tenant isolation', () => {
  beforeAll(async () => {
    await resetDb(db);
    await seedPlans(db);
    A = await seedTenant(db, 'PlanA');
    B = await seedTenant(db, 'PlanB');
    const aAccount = await attachSubscription(db, A.restaurantId, { planKey: 'basic' });
    // A2 is a second restaurant on A's billing account (a chain branch) with its own members.
    A2 = await seedTenant(db, 'PlanA2');
    await db.update(restaurants).set({ billingAccountId: aAccount }).where(eq(restaurants.id, A2.restaurantId));
    for (let i = 0; i < 2; i += 1) {
      const [u] = await db.insert(users).values({ email: `plan-a2-${i}@attack.test` }).returning();
      await db.insert(memberships).values({ userId: u!.id, restaurantId: A2.restaurantId, role: 'receiver' });
    }
    await db.insert(usageCounters).values({ billingAccountId: aAccount, period: usagePeriod(), metric: 'ocr_scans', used: 5 });
    const trialEnd = new Date(Date.now() + 10 * 86_400_000);
    const bAccount = await attachSubscription(db, B.restaurantId, { planKey: 'pro', status: 'trialing', trialEndsAt: trialEnd });
    // B has extra members and heavy usage; none of it may reach A's view.
    for (let i = 0; i < 3; i += 1) {
      const [u] = await db.insert(users).values({ email: `plan-b-${i}@attack.test` }).returning();
      await db.insert(memberships).values({ userId: u!.id, restaurantId: B.restaurantId, role: 'receiver' });
    }
    await db.insert(usageCounters).values({ billingAccountId: bAccount, period: usagePeriod(), metric: 'ocr_scans', used: 77 });
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('A sees only its own plan, quota and seats', async () => {
    const a = await callerFor(A, 'owner').settings.planUsage();
    expect(a.planKey).toBe('basic');
    expect(a.status).toBe('active');
    expect(a.trialEndsAt).toBeNull();
    expect(a.implicit).toBe(false);
    expect(a.scans.used).toBe(5);
    expect(a.seatsUsed).toBe(1);
  });

  it('B sees its own plan, trial end, usage and seats', async () => {
    const b = await callerFor(B, 'owner').settings.planUsage();
    expect(b.planKey).toBe('pro');
    expect(b.status).toBe('trialing');
    expect(b.trialEndsAt).not.toBeNull();
    expect(b.scans.used).toBe(77);
    expect(b.seatsUsed).toBe(4);
  });

  it('a sibling on the same account shares plan and scans, but seats are per restaurant', async () => {
    const a2 = await callerFor(A2, 'owner').settings.planUsage();
    expect(a2.planKey).toBe('basic');
    expect(a2.scans.used).toBe(5);
    expect(a2.seatsUsed).toBe(3);
    const a = await callerFor(A, 'owner').settings.planUsage();
    expect(a.seatsUsed).toBe(1);
  });

  it('the manager may read it', async () => {
    await expect(callerFor(A, 'manager').settings.planUsage()).resolves.toMatchObject({ planKey: 'basic' });
  });

  it('the bookkeeper may read it; chef and receiver are FORBIDDEN', async () => {
    await expect(callerFor(A, 'bookkeeper').settings.planUsage()).resolves.toMatchObject({ planKey: 'basic' });
    await expect(callerFor(A, 'chef').settings.planUsage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A, 'receiver').settings.planUsage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('it carries no ₪ (plan names and counts only)', async () => {
    const a = await callerFor(A, 'owner').settings.planUsage();
    expect(JSON.stringify(a)).not.toMatch(/price|agorot|₪/i);
  });
});
