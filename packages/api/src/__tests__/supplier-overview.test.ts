import { testDbUrl } from '@restomatch/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, discrepancies, eq, invoices } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { supplierLeakWindow } from '../ledger/overview';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W2-11 · suppliers.overview / suppliers.table: ONE 90-day leak figure, the
 * same as owner.leakGrouped (the leak card's source) for that supplier;
 * finance roles only.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  // Make the seeded discrepancy a ₪ leak inside the 90-day window.
  await db.update(invoices).set({ invoiceDate: new Date() }).where(eq(invoices.id, A.invoiceId));
  await db
    .update(discrepancies)
    .set({ severity: 'warn', deltaAmount: '12.34', resolutionStatus: 'open' })
    .where(eq(discrepancies.id, A.discrepancyId));
});
afterAll(async () => {
  await resetDb(db);
});

describe('suppliers.overview', () => {
  it('the header ₪ = owner.leakGrouped for that supplier over the 90-day window', async () => {
    const o = await callerFor(A).suppliers.overview({ supplierId: A.supplierId });
    const window = supplierLeakWindow(new Date());
    expect(o.window).toEqual(window);
    const g = await callerFor(A).owner.leakGrouped({
      view: { period: 'custom', ...window, filters: { supplierIds: [A.supplierId] } },
      groupBy: 'supplier',
      compare: 'off',
    });
    const row = g.rows.find((r) => r.key === A.supplierId);
    expect(o.leakAgorot).toBe(Math.round((row?.leakIls ?? 0) * 100));
    expect(o.leakAgorot).toBeGreaterThan(0);
    // Still open: all of it is open to act on.
    expect(o.openAgorot).toBe(o.leakAgorot);
    expect(o.spend).toHaveLength(6);
    expect(o.lastInvoices[0]?.id).toBe(A.invoiceId);
  });

  it('a resolved line leaves the open ₪ but stays in the leak', async () => {
    await db.update(discrepancies).set({ resolutionStatus: 'accepted' }).where(eq(discrepancies.id, A.discrepancyId));
    const o = await callerFor(A).suppliers.overview({ supplierId: A.supplierId });
    expect(o.leakAgorot).toBeGreaterThan(0);
    expect(o.openAgorot).toBe(0);
  });

  it('is finance-tier: receiver and chef are FORBIDDEN, bookkeeper and manager read', async () => {
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerFor(A, role).suppliers.overview({ supplierId: A.supplierId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A, role).suppliers.table()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    for (const role of ['manager', 'bookkeeper'] as const) {
      await expect(callerFor(A, role).suppliers.overview({ supplierId: A.supplierId })).resolves.toBeTruthy();
    }
  });
});

describe('suppliers.table', () => {
  it('one row per supplier, leak = the overview figure, totals = Σ rows', async () => {
    const t = await callerFor(A).suppliers.table();
    const o = await callerFor(A).suppliers.overview({ supplierId: A.supplierId });
    const row = t.rows.find((r) => r.supplierId === A.supplierId);
    expect(row?.leakAgorot).toBe(o.leakAgorot);
    expect(t.totals.leakAgorot).toBe(t.rows.reduce((s, r) => s + r.leakAgorot, 0));
    expect(t.totals.monthSpendAgorot).toBe(t.rows.reduce((s, r) => s + r.monthSpendAgorot, 0));
    expect(t.totals.openAgorot).toBe(t.rows.reduce((s, r) => s + r.openAgorot, 0));
    // The month's spend is the leak views' own spend definition (home / leak hub).
    const { computeLeakSummary } = await import('@restomatch/charts');
    const hero = await computeLeakSummary(db, A.restaurantId, { period: 'this_month', filters: { supplierIds: [A.supplierId] } });
    expect(row?.monthSpendAgorot).toBe(Math.round(hero.spendIls * 100));
    // Sorted by the 90-day leak, biggest first.
    const leaks = t.rows.map((r) => r.leakAgorot);
    expect(leaks).toEqual([...leaks].sort((a, b) => b - a));
  });
});
