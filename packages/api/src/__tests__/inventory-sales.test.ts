import { beforeAll, describe, expect, it } from 'vitest';
import { and, auditLog, eq, inventoryCounts } from '@restomatch/db';
import { callerAs, count, db, freshLab, price, product, type Lab } from './inventory-w207-helpers';

/**
 * W2-07 · foodcost-01: the food-sales denominator is set by a manager+ through
 * `setSales`, every change audited (before/after), allowed after close; `setMeta`
 * no longer takes sales for anyone; the PeriodCard shows who set it.
 */
let A: Lab;
let B: Lab;
let closing: string;

beforeAll(async () => {
  [A, B] = (await freshLab(['SA', 'SB'])) as [Lab, Lab];
  const beef = await product(A!.t, 'אנטריקוט', 'ק״ג', 'בשר');
  await price(A!.t, beef, 40, '100.0000');
  await count(A!, 30, { [beef]: '5' });
  closing = await count(A!, 2, { [beef]: '3' });
});

describe('inventory.setSales', () => {
  it('owner and manager set sales, on a closed count, each change audited with before/after', async () => {
    await callerAs(A, 'manager').inventory.setSales({ countId: closing, foodSalesExVat: '40000.00' });
    await callerAs(A, 'owner').inventory.setSales({ countId: closing, foodSalesExVat: '42000.50' });
    const [c] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, closing));
    expect(c!.foodSalesExVat).toBe('42000.50');
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, closing), eq(auditLog.action, 'inventory.sales_set')))
      .orderBy(auditLog.at);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: A.users.manager, before: { foodSalesExVat: null }, after: { foodSalesExVat: '40000.00', status: 'completed' } });
    expect(rows[1]).toMatchObject({ userId: A.t.ownerUserId, before: { foodSalesExVat: '40000.00' }, after: { foodSalesExVat: '42000.50' } });
  });

  it('the same value again writes no second audit row', async () => {
    const r = await callerAs(A, 'owner').inventory.setSales({ countId: closing, foodSalesExVat: '42000.5' });
    expect(r.changed).toBe(false);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entityId, closing), eq(auditLog.action, 'inventory.sales_set')));
    expect(rows).toHaveLength(2);
  });

  it('chef, receiver and bookkeeper are FORBIDDEN', async () => {
    for (const role of ['chef', 'receiver', 'bookkeeper'] as const) {
      await expect(callerAs(A, role).inventory.setSales({ countId: closing, foodSalesExVat: '1.00' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('setMeta({ foodSalesExVat }) is rejected for every role (no second route to the denominator)', async () => {
    for (const role of ['owner', 'manager', 'chef'] as const) {
      await expect(
        callerAs(A, role).inventory.setMeta({ countId: closing, foodSalesExVat: '1.00' } as unknown as { countId: string }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    const [c] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, closing));
    expect(c!.foodSalesExVat).toBe('42000.50');
  });

  it('the period says who entered the sales and when', async () => {
    const p = await callerAs(A, 'owner').inventory.period();
    expect(p.salesEntry).toMatchObject({ by: 'Owner SA' });
    expect(typeof p.salesEntry!.at).toBe('string');
  });

  it("tenant B can't set A's sales (NOT_FOUND, A untouched)", async () => {
    await expect(callerAs(B, 'owner').inventory.setSales({ countId: closing, foodSalesExVat: '1.00' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [c] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, closing));
    expect(c!.foodSalesExVat).toBe('42000.50');
  });
});
