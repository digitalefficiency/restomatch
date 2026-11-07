import { createDb, discrepancies, eq, restaurants, testDbUrl } from '@restomatch/db';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AppContext, Session } from '../context';
import { appRouter } from '../index';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-08 · "דוח החודש" — who reads the month report, and only their own.
 *   - monthlyReport.breakdown (new) is caller-scoped: tenant B's breakdown never
 *     names A's supplier or carries A's leak, and the reverse;
 *   - owner decision I3: the bookkeeper reads preview / breakdown / digest / pdf;
 *     the receiver and the chef are FORBIDDEN on every one of them.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db
      .update(restaurants)
      .set({ settings: { features: { monthlyReport: true, monthlyDigestPreview: true } } as never })
      .where(eq(restaurants.id, t.restaurantId));
  }
  // B's only discrepancy is cleared: B has no leak, A keeps its seeded one.
  await db.delete(discrepancies).where(eq(discrepancies.restaurantId, B.restaurantId));
});

describe('monthlyReport.breakdown: tenant scope', () => {
  it("A's breakdown is A's; B's never names A's supplier or carries A's leak", async () => {
    const month = thisMonth();
    const a = await callerFor(A).monthlyReport.breakdown({ month });
    const b = await callerFor(B).monthlyReport.breakdown({ month });
    expect(JSON.stringify(a)).not.toContain(B.supplierName);
    expect(JSON.stringify(a)).not.toContain(B.supplierId);
    expect(JSON.stringify(b)).not.toContain(A.supplierName);
    expect(JSON.stringify(b)).not.toContain(A.supplierId);
    expect(b.byType).toEqual([]);
    expect(b.hero.leakIls).toBe(0);
    // The check above can fail: A does have rows of its own.
    expect(a.bySupplier.map((s) => s.supplierId)).toEqual(a.bySupplier.map(() => A.supplierId));
  });

  it('takes no restaurant id: a smuggled field is stripped, the session decides', async () => {
    const r = await callerFor(B).monthlyReport.breakdown({ month: thisMonth(), restaurantId: A.restaurantId } as never);
    expect(JSON.stringify(r)).not.toContain(A.supplierName);
  });
});

describe('owner decision I3: the bookkeeper reads the month report; receiver and chef never', () => {
  it('bookkeeper reads preview, breakdown, digest and pdf', async () => {
    const month = thisMonth();
    const bk = callerFor(A, 'bookkeeper');
    await expect(bk.monthlyReport.preview({ month, locale: 'he' })).resolves.toMatchObject({ data: { restaurantName: 'Resto A' } });
    await expect(bk.monthlyReport.breakdown({ month })).resolves.toMatchObject({ month });
    await expect(bk.monthlyReport.digest({ month, locale: 'he' })).resolves.toMatchObject({ data: { restaurantName: 'Resto A' } });
    const pdf = await bk.monthlyReport.pdf({ month, locale: 'he' });
    expect(pdf.base64.length).toBeGreaterThan(100);
  });

  for (const role of ['receiver', 'chef'] as const) {
    it(`${role} is FORBIDDEN on every month-report procedure`, async () => {
      const month = thisMonth();
      const c = callerFor(A, role);
      await expect(c.monthlyReport.preview({ month, locale: 'he' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(c.monthlyReport.breakdown({ month })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(c.monthlyReport.digest({ month, locale: 'he' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(c.monthlyReport.pdf({ month, locale: 'he' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  }
});
