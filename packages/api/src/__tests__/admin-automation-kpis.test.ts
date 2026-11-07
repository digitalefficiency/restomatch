import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createDb, eq, restaurants, sql, testDbUrl, userCredentials, users } from '@restomatch/db';
import { AUTOMATION_NEVER_CLAIMABLE } from '@restomatch/charts';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resolveAppError } from '../errors';
import { NEVER_CLAIMABLE_TYPES } from '../lib/claims';
import { FEATURE_KEYS } from '../lib/features';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * AU-07 · admin.automationKpis — a cross-tenant admin READ. It must stay inside
 * input.restaurantId (adminProcedure runs without the tenant RLS scope), refuse
 * non-admins and admins without TOTP, write nothing, and keep hours-₪ apart
 * from the ₪ funnel.
 */

const db = createDb(testDbUrl());

function caller(userId: string) {
  const session: Session = { userId, restaurantId: null, role: null };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

let A: Tenant;
let B: Tenant;
let adminUserId: string;

beforeEach(async () => {
  await resetDb(db);
  await seedPlans(db);
  A = await seedTenant(db, 'AutoA');
  B = await seedTenant(db, 'AutoB');
  const [admin] = await db
    .insert(users)
    .values({ email: 'ops-au07@restomatch.co', name: 'Ops', isPlatformAdmin: true })
    .returning();
  adminUserId = admin!.id;
  await db.insert(userCredentials).values({ userId: adminUserId, totpSecretEnc: 'ciphertext', totpEnabledAt: new Date() });
});

afterAll(async () => {
  await resetDb(db);
});

/** Row count of every public base table (a write anywhere moves it). */
async function tableCounts(): Promise<Record<string, number>> {
  const res = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)) as unknown as Array<{
    table_name: string;
  }>;
  const out: Record<string, number> = {};
  for (const { table_name } of res) {
    const rows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM ${sql.identifier(table_name)}`)) as unknown as Array<{
      n: number;
    }>;
    out[table_name] = Number(rows[0]!.n);
  }
  return out;
}

describe('admin.automationKpis · access', () => {
  it('a tenant owner (not a platform admin) is FORBIDDEN', async () => {
    await expect(caller(A.ownerUserId).admin.automationKpis({ restaurantId: A.restaurantId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('a platform admin without TOTP is FORBIDDEN (admin_requires_2fa)', async () => {
    await db.delete(userCredentials).where(eq(userCredentials.userId, adminUserId));
    const err = (await caller(adminUserId)
      .admin.automationKpis({ restaurantId: A.restaurantId })
      .then(
        () => null,
        (e: unknown) => e,
      )) as TRPCError | null;
    expect(err).toMatchObject({ code: 'FORBIDDEN' });
    expect(resolveAppError(err!)?.appCode).toBe('admin_requires_2fa');
  });

  it('an unknown restaurant is NOT_FOUND', async () => {
    await expect(
      caller(adminUserId).admin.automationKpis({ restaurantId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects weeks outside 1..12', async () => {
    await expect(caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId, weeks: 13 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('admin.automationKpis · read', () => {
  it('reads A only: the result names A and carries none of B', async () => {
    const res = await caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId, weeks: 12 });
    expect(res.restaurantId).toBe(A.restaurantId);
    expect(res.weeks).toHaveLength(12);
    const json = JSON.stringify(res);
    for (const id of [B.restaurantId, B.invoiceId, B.matchRunId, B.supplierId]) expect(json).not.toContain(id);
    // Same numbers as when B does not exist at all.
    const aOnly = res.weeks.map((w) => [w.docsIn, w.funnelAgorot.found, w.zeroTouchDenominator]);
    await db.delete(restaurants).where(eq(restaurants.id, B.restaurantId));
    const again = await caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId, weeks: 12 });
    expect(again.weeks.map((w) => [w.docsIn, w.funnelAgorot.found, w.zeroTouchDenominator])).toEqual(aOnly);
  });

  it('writes nothing — not even an audit row', async () => {
    const before = await tableCounts();
    await caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId, weeks: 8 });
    expect(await tableCounts()).toEqual(before);
  });

  it('flagsOn counts the tenant flags with FEATURES_OFF applied (computed in the procedure)', async () => {
    const on = FEATURE_KEYS.slice(0, 3);
    await db
      .update(restaurants)
      .set({ settings: { features: Object.fromEntries(on.map((k) => [k, true])) } as never })
      .where(eq(restaurants.id, A.restaurantId));
    const res = await caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId });
    expect(res.flagsOn).toBe(3);
    expect(res.flagsTotal).toBe(FEATURE_KEYS.length);

    process.env.FEATURES_OFF = on[0];
    try {
      expect((await caller(adminUserId).admin.automationKpis({ restaurantId: A.restaurantId })).flagsOn).toBe(2);
    } finally {
      delete process.env.FEATURES_OFF;
    }
  });

  it('keeps the time ledger apart from the ₪ funnel (disjoint key sets, separate result key)', async () => {
    const res = await caller(adminUserId).admin.automationKpis({
      restaurantId: A.restaurantId,
      rates: { owner: 150 },
    });
    expect(res.timeLedger.assumptions.find((a) => a.key === 'rate.owner')!.value).toBe(150);
    const ledgerKeys = new Set(Object.keys(res.timeLedger));
    for (const w of res.weeks) {
      for (const k of Object.keys(w.funnelAgorot)) expect(ledgerKeys.has(k)).toBe(false);
      expect(w).not.toHaveProperty('timeLedger');
    }
  });

  it('the charts never-claimable list is the api one (charts cannot import api)', () => {
    expect([...AUTOMATION_NEVER_CLAIMABLE].sort()).toEqual([...NEVER_CLAIMABLE_TYPES].sort());
  });
});
