import { createDb, eq, restaurants, testDbUrl } from '@restomatch/db';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context';
import { appRouter } from '../index';
import { israelMonth, resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * monthlyReport.pdf renders the CALLER's restaurant only. The cross-tenant
 * COVERAGE entry ('monthlyReport.pdf': 'isolation') could only check that some
 * PDF came back — the bytes are compressed with embedded fonts, so a B name is
 * not greppable. Here the renderer is wrapped (the real one still runs) and the
 * report data each call hands it is asserted: A's caller → Resto A's data, with
 * nothing of tenant B in it.
 */
const rendered = vi.hoisted(() => [] as unknown[]);
vi.mock('../reports/pdf', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../reports/pdf')>();
  return {
    ...orig,
    renderMonthlyReportPdf: async (...args: Parameters<typeof orig.renderMonthlyReportPdf>) => {
      rendered.push(args[0]);
      return orig.renderMonthlyReportPdf(...args);
    },
  };
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

const callerFor = (t: Tenant) =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'owner' } } as AppContext);

const thisMonth = () => {
  const now = new Date();
  return israelMonth(now);
};

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  for (const t of [A, B]) {
    await db
      .update(restaurants)
      .set({ settings: { features: { monthlyReport: true } } as never })
      .where(eq(restaurants.id, t.restaurantId));
  }
});
beforeEach(() => {
  rendered.length = 0;
});

describe('monthlyReport.pdf: tenant scope of the rendered report', () => {
  it("A's PDF is rendered from Resto A's data only (no B restaurant, supplier or id)", async () => {
    const pdf = await callerFor(A).monthlyReport.pdf({ month: thisMonth(), locale: 'en' });
    expect(pdf.base64.length).toBeGreaterThan(100);
    expect(rendered).toHaveLength(1);
    const data = rendered[0] as { restaurantName: string };
    expect(data.restaurantName).toBe('Resto A');
    const json = JSON.stringify(data);
    for (const leak of ['Resto B', B.supplierName, B.restaurantId, B.supplierId, B.invoiceId]) {
      expect(json, `A's report data contains ${leak}`).not.toContain(leak);
    }
  });

  it("B's PDF is B's: the captured data follows the caller (the check above can fail)", async () => {
    await callerFor(B).monthlyReport.pdf({ month: thisMonth(), locale: 'he' });
    expect(rendered).toHaveLength(1);
    expect((rendered[0] as { restaurantName: string }).restaurantName).toBe('Resto B');
    expect(JSON.stringify(rendered[0])).not.toContain(A.supplierName);
  });
});
