/**
 * W3-07a · settings.planUsage — read-only plan & usage, tenant-isolated.
 * A and B sit on different plans with different members and usage; each sees
 * only its own. Kitchen / dock roles never see it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, memberships, testDbUrl, usageCounters, users } from '@restomatch/db';
import { appRouter } from '../index';
import { usagePeriod } from '../entitlements';
import type { AppContext, Session } from '../context';
import { attachSubscription, resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

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
    await attachSubscription(db, A.restaurantId, { planKey: 'basic' });
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
    expect(a.scans.used).toBe(0);
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
