import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { discrepancies, eq, invoices } from '@restomatch/db';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { callerFor, db, FINANCE } from './owner-test-helpers';

let A: Tenant;
let B: Tenant;
const NOW = new Date();
beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  // Both tenants' invoices dated now, so they fall in this month's window.
  for (const t of [A, B]) {
    await db.update(invoices).set({ invoiceDate: NOW, totalInclVat: '100000' }).where(eq(invoices.id, t.invoiceId));
    await db.update(discrepancies).set({ type: 'PRICE_HIGHER', severity: 'warn', deltaAmount: t === A ? '74.00' : '999.00' }).where(eq(discrepancies.id, t.discrepancyId));
  }
});
afterAll(async () => resetDb(db));

const view = { period: 'this_month' as const };

describe('owner.leakComparison / owner.leakDrivers (W2-09c)', () => {
  it('Σ drivers + other = the comparison Δ, and only A’s rows count (isolation)', async () => {
    const c = await callerFor(A).owner.leakComparison({ view });
    expect(c.current.leakIls).toBe(74); // B's ₪999 never appears
    const d = await callerFor(A).owner.leakDrivers({ view });
    expect(d.drivers.reduce((s, x) => s + x.deltaAgorot, 0) + d.otherAgorot).toBe(d.comparison.deltaAgorot);
    expect(d.drivers.every((x) => x.currentAgorot <= 7400)).toBe(true);
    const json = JSON.stringify(d);
    expect(json).not.toContain(B.supplierName);
    expect(json).not.toContain('99900');
  });

  it('finance tier: owner, manager and bookkeeper; receiver and chef FORBIDDEN', async () => {
    for (const role of FINANCE) await expect(callerFor(A, role).owner.leakDrivers({ view })).resolves.toBeDefined();
    for (const role of ['receiver', 'chef'] as const) {
      await expect(callerFor(A, role).owner.leakDrivers({ view })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerFor(A, role).owner.leakComparison({ view })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
