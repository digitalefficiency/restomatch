/**
 * W2-14 attack suite: the new settings / team / exports procedures never reach
 * another tenant, and the self-only phone write touches only the caller's row.
 * Same caller pattern as cross-tenant.attack.test.ts (`callerWithRole`).
 */
import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, createDb, eq, memberships, restaurants, users } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());

let A: Tenant;
let B: Tenant;

function callerWithRole(tenant: Tenant, role: Session['role'], userId = tenant.ownerUserId) {
  const session: Session = { userId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

describe('W2-14 settings / team / exports: tenant isolation', () => {
  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
    B = await seedTenant(db, 'B');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  it('settings.effective reads only the caller restaurant overrides', async () => {
    await db
      .update(restaurants)
      .set({ settings: { approvalThresholds: { unorderedItemSignificant: 250 } } })
      .where(eq(restaurants.id, A.restaurantId));
    await db
      .update(restaurants)
      .set({ settings: { approvalThresholds: { largeInvoiceWithoutPo: 1 } } })
      .where(eq(restaurants.id, B.restaurantId));
    const eff = await callerWithRole(A, 'owner').settings.effective();
    expect(eff.approvalThresholds.largeInvoiceWithoutPo).toEqual({ value: 5000, isDefault: true });
    expect(eff.approvalThresholds.unorderedItemSignificant).toEqual({ value: 250, isDefault: false });
  });

  it('settings.history never shows another tenant audit rows', async () => {
    await callerWithRole(B, 'owner').settings.update({ ocrReviewThreshold: 0.5 });
    const hist = await callerWithRole(A, 'owner').settings.history();
    expect(hist).toHaveLength(0);
  });

  it('settings.history is FORBIDDEN for receiver and chef', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerWithRole(A, role).settings.history()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('settings.setMyPhone writes only the caller users row', async () => {
    await db.update(users).set({ phone: '+972500000000' }).where(eq(users.id, B.ownerUserId));
    const out = await callerWithRole(A, 'owner').settings.setMyPhone({ phone: '050-123 4567' });
    expect(out).toEqual({ phone: '+972501234567', verified: false });
    const [b] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, B.ownerUserId));
    expect(b?.phone).toBe('+972500000000');
    const mine = await callerWithRole(A, 'owner').settings.myPhone();
    expect(mine.phone).toBe('+972501234567');
    expect(mine.verified).toBe(false);
  });

  it('team.transferOwnership to a B user → NOT_FOUND, nothing changes on either side', async () => {
    await expect(
      callerWithRole(A, 'owner').team.transferOwnership({ toUserId: B.ownerUserId, myNewRole: 'manager' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const aRoles = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, A.ownerUserId)));
    expect(aRoles.map((r) => r.role)).toEqual(['owner']);
    const bInA = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.restaurantId, A.restaurantId), eq(memberships.userId, B.ownerUserId)));
    expect(bInA).toHaveLength(0);
  });

  it('team.transferOwnership is FORBIDDEN for every non-owner role', async () => {
    for (const role of ['manager', 'bookkeeper', 'receiver', 'chef'] as const) {
      await expect(
        callerWithRole(A, role).team.transferOwnership({ toUserId: B.ownerUserId, myNewRole: 'manager' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('exports.summary counts only the caller restaurant invoices', async () => {
    // Absolute values from A's seed alone (1 invoice, ₪117 incl. VAT, one open ₪100
    // gap): a leak of B's identical seed would double every figure.
    const a = await callerWithRole(A, 'owner').exports.summary({ from: '2000-01-01', to: '2100-12-31' });
    expect(a).toMatchObject({
      invoiceCount: 1,
      totalInclVat: '117.00',
      withOpenGapCount: 1,
      amountInDispute: '100.00',
    });
  });
});
