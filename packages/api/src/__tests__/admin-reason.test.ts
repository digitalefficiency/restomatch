/**
 * W3-07a: platform-admin writes are staged in the console and confirmed with a
 * typed reason. The server is the guarantee: no reason → BAD_REQUEST and nothing
 * written; with one, the audit row's `after.reason` holds the trimmed text.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, auditLog, createDb, eq, memberships, testDbUrl, userCredentials, users } from '@restomatch/db';
import { appRouter } from '../index';
import { getEntitlements } from '../entitlements';
import type { AppContext, Session } from '../context';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());

function adminCaller(userId: string) {
  const session: Session = { userId, restaurantId: null, role: null };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

let T: Tenant;
let adminUserId: string;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  T = await seedTenant(db, 'ReasonT');
  const [admin] = await db
    .insert(users)
    .values({ email: 'ops-reason@restomatch.co', name: 'Ops', isPlatformAdmin: true })
    .returning();
  adminUserId = admin!.id;
  await db.insert(userCredentials).values({ userId: adminUserId, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });
});

afterAll(async () => {
  await resetDb(db);
});

async function auditRows(action: string) {
  return db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.restaurantId, T.restaurantId), eq(auditLog.action, action)));
}

describe('admin writes require a reason (W3-07a)', () => {
  it('assignPlan without a reason is BAD_REQUEST and writes nothing', async () => {
    await expect(
      adminCaller(adminUserId).admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getEntitlements(db, T.restaurantId)).planKey).toBe('trial');
    expect(await auditRows('admin.plan_assigned')).toHaveLength(0);
  });

  it('a whitespace-only or too-short reason is rejected', async () => {
    const c = adminCaller(adminUserId);
    await expect(
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', reason: '    ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', reason: ' ab ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', reason: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('assignPlan stores the trimmed reason in audit after.reason', async () => {
    await adminCaller(adminUserId).admin.assignPlan({
      restaurantId: T.restaurantId,
      planKey: 'pro',
      reason: '  שדרוג לפיילוט  ',
    });
    const rows = await auditRows('admin.plan_assigned');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({ planKey: 'pro', reason: 'שדרוג לפיילוט' });
  });

  it('setOverrides requires a reason and stores it beside the overrides', async () => {
    const c = adminCaller(adminUserId);
    await c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'basic', reason: 'בסיס' });
    await expect(
      c.admin.setOverrides({ restaurantId: T.restaurantId, overrides: { features: ['accounting_export'] } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getEntitlements(db, T.restaurantId)).features).not.toContain('accounting_export');

    await c.admin.setOverrides({
      restaurantId: T.restaurantId,
      overrides: { features: ['accounting_export'] },
      reason: 'ייצוא לרואה החשבון',
    });
    const rows = await auditRows('admin.overrides_set');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ overrides: { features: ['accounting_export'] }, reason: 'ייצוא לרואה החשבון' });
    // The reason is audit-only: it never lands in the stored overrides.
    const ent = await getEntitlements(db, T.restaurantId);
    expect(ent.features).toContain('accounting_export');
  });

  it('control and bidi-override characters are dropped before the length check', async () => {
    const c = adminCaller(adminUserId);
    await expect(
      c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', reason: '\u202e\u202d\n\t' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await c.admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro', reason: 'שדרוג\u202e לפיילוט' });
    const rows = await auditRows('admin.plan_assigned');
    expect((rows[0]!.after as { reason: string }).reason).toBe('שדרוג  לפיילוט');
  });

  it('setMemberRole requires a reason and records it', async () => {
    const [u] = await db.insert(users).values({ email: 'cook-reason@test.local' }).returning();
    await db.insert(memberships).values({ userId: u!.id, restaurantId: T.restaurantId, role: 'receiver' });
    const c = adminCaller(adminUserId);
    await expect(
      c.admin.setMemberRole({ restaurantId: T.restaurantId, userId: u!.id, role: 'chef' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const [still] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, T.restaurantId), eq(memberships.userId, u!.id)));
    expect(still!.role).toBe('receiver');

    await c.admin.setMemberRole({ restaurantId: T.restaurantId, userId: u!.id, role: 'chef', reason: 'עבר למטבח' });
    const rows = await auditRows('admin.role_set');
    expect(rows[0]!.after).toEqual({ role: 'chef', reason: 'עבר למטבח' });
  });

  it('setFeatures requires a reason (AU-01 carve-out ended) and records it', async () => {
    const c = adminCaller(adminUserId);
    await expect(
      c.admin.setFeatures({ restaurantId: T.restaurantId, features: { contracts: true } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await auditRows('admin.features')).toHaveLength(0);
    await c.admin.setFeatures({ restaurantId: T.restaurantId, features: { contracts: false }, reason: 'כיבוי זמני' });
    const rows = await auditRows('admin.features');
    expect(rows).toHaveLength(1);
    expect((rows[0]!.after as { reason?: string }).reason).toBe('כיבוי זמני');
    await expect(
      c.admin.setFeatures({ restaurantId: T.restaurantId, features: { contracts: true }, reason: ' ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a non-admin is still FORBIDDEN before input validation', async () => {
    await expect(
      adminCaller(T.ownerUserId).admin.assignPlan({ restaurantId: T.restaurantId, planKey: 'pro' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
