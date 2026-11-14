import { beforeAll, describe, expect, it } from 'vitest';
import { callerAs, count, freshLab, price, product, receipt, type Lab } from './inventory-w207-helpers';

/**
 * W3-02b · inventory.controlRoom. The equation it returns adds up to exactly
 * the period's actual food cost (same periods as inventory.period, to the
 * agora), every term drills to its source, and the sparkline holds one point
 * per closed count. ₪ for owner / manager / bookkeeper only: the chef and the
 * receiver are FORBIDDEN. Tenant B never sees A's counts.
 */
let A: Lab;
let B: Lab;
let opening: string;
let closing: string;

beforeAll(async () => {
  [A, B] = (await freshLab(['A', 'B'])) as [Lab, Lab];
  const beef = await product(A.t, 'אנטריקוט', 'ק״ג', 'בשר');
  const tomato = await product(A.t, 'עגבנייה', 'ק״ג', 'ירקות');
  await price(A.t, beef, 40, '100.0000');
  await price(A.t, tomato, 40, '6.0000');
  opening = await count(A, 20, { [beef]: '10', [tomato]: '20' });
  await receipt(A.t, beef, 'ק״ג', 10, '5', null, 'completed');
  closing = await count(A, 2, { [beef]: '8', [tomato]: '15' });
  await callerAs(A, 'manager').inventory.setSales({ countId: closing, foodSalesExVat: '4000.00' });
  // B has its own closed count, which A must never see.
  const bBeef = await product(B.t, 'אנטריקוט', 'ק״ג', 'בשר');
  await price(B.t, bBeef, 40, '999.0000');
  await count(B, 5, { [bBeef]: '1' });
});

describe('inventory.controlRoom', () => {
  it('the equation equals the period to the agora, and every term drills to its source', async () => {
    const owner = callerAs(A, 'owner');
    const [room, period] = await Promise.all([owner.inventory.controlRoom(), owner.inventory.period()]);
    expect(period.available).toBe(true);
    if (!period.available) return;
    const eq = room.equation!;
    expect(eq.usageAgorot).toBe(period.actualAgorot);
    expect(eq.actualBp).toBe(period.actualBp);
    expect(eq.sales.agorot).toBe(400_000);
    expect(room.period).toEqual({ from: period.opening.countDate, to: period.closing.countDate });
    expect(eq.terms.find((t) => t.key === 'opening')!.drill).toEqual({ kind: 'count', countId: opening });
    expect(eq.terms.find((t) => t.key === 'closing')!.drill).toEqual({ kind: 'count', countId: closing });
    expect(eq.terms.find((t) => t.key === 'purchases')!.drill).toMatchObject({ kind: 'invoices' });
    expect(eq.terms.find((t) => t.key === 'credits')!.drill).toMatchObject({ kind: 'credits' });
  });

  it('the sparkline has one point per closed count, oldest → newest; the first (no opening) is a gap', async () => {
    const room = await callerAs(A, 'owner').inventory.controlRoom();
    expect(room.series.points.map((p) => p.closingCountId)).toEqual([opening, closing]);
    expect(room.series.points[0]!.bp).toBeNull();
    expect(room.series.latest?.closingDate).toBe(room.series.points[1]!.closingDate);
    expect(room.targetBp).toBe(room.series.targetBp);
  });

  it('owner, manager and bookkeeper read it; the chef and the receiver are FORBIDDEN (all ₪)', async () => {
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) await expect(callerAs(A, role).inventory.controlRoom()).resolves.toBeDefined();
    for (const role of ['chef', 'receiver'] as const) await expect(callerAs(A, role).inventory.controlRoom()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("tenant isolation: B's control room holds only B's count, never A's", async () => {
    const room = await callerAs(B, 'owner').inventory.controlRoom();
    const ids = room.series.points.map((p) => p.closingCountId);
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(opening);
    expect(ids).not.toContain(closing);
    expect(room.equation).toBeNull();
  });
});
