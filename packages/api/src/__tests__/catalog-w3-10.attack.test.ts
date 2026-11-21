import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, invoiceLines, supplierCatalogItems, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10b · mapping.queue / mapping.queueSummary carry ₪ (unmapped invoice
 * money), so: tenant B's lines, review rows and ₪ never reach A — not even with
 * B's supplierId as the filter — and only owner / manager / bookkeeper (read-only,
 * owner decision 7) may read them; chef and receiver see no ₪.
 */
const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant, role: Session['role'] = 'owner') {
  return appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);
}

async function unlinked(t: Tenant, sku: string | null, name: string, total: string) {
  await db.insert(invoiceLines).values({
    invoiceId: t.invoiceId,
    productId: null,
    supplierSku: sku,
    rawDescription: name,
    qtyBilled: '1',
    unit: 'kg',
    unitPriceBilled: total,
    lineTotal: total,
  });
  await db.insert(supplierCatalogItems).values({
    restaurantId: t.restaurantId,
    supplierId: t.supplierId,
    supplierSku: sku ? `${sku}-PL` : null,
    supplierNameRaw: `${name} מחירון`,
  });
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  await unlinked(A, 'A-1', 'שורה של A', '10.00');
  await unlinked(B, 'B-1', 'שורה של B', '9999.99');
  await unlinked(B, null, 'בלי מקט של B', '500.00');
});
afterAll(() => resetDb(db));

describe('W3-10b mapping.queue — cross-tenant', () => {
  it("B's rows and ₪ never list for A", async () => {
    const { rows, summary } = await callerFor(A).mapping.queue({ suggestFor: 0 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.supplierId === A.supplierId)).toBe(true);
    expect(rows.some((r) => r.nameRaw.includes('של B') || r.supplierSku?.startsWith('B-'))).toBe(false);
    expect(summary.unmappedAgorot).toBeLessThan(999999);
    expect(summary.unmappedAgorot).toBe(rows.reduce((s, r) => s + r.unmappedAgorot, 0));
  });

  it("A filtering by B's supplierId gets an empty queue, not B's rows", async () => {
    const res = await callerFor(A).mapping.queue({ supplierId: B.supplierId });
    expect(res.rows).toEqual([]);
    expect(res.summary).toEqual({ count: 0, unmappedAgorot: 0 });
  });

  it("queueSummary sums only the caller's restaurant", async () => {
    const a = await callerFor(A).mapping.queueSummary();
    const b = await callerFor(B).mapping.queueSummary();
    expect(a.unmappedAgorot).toBeLessThan(b.unmappedAgorot);
    expect(b.unmappedAgorot).toBeGreaterThanOrEqual(1049999);
  });

  it.each(['chef', 'receiver'] as const)('%s → FORBIDDEN on both (the queue carries ₪)', async (role) => {
    await expect(callerFor(A, role).mapping.queue()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(callerFor(A, role).mapping.queueSummary()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['manager', 'bookkeeper'] as const)('%s reads it', async (role) => {
    await expect(callerFor(A, role).mapping.queueSummary()).resolves.toMatchObject({ count: expect.any(Number) });
  });
});
