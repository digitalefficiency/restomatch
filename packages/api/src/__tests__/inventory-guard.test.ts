import { describe, expect, it, beforeAll } from 'vitest';
import { guardLine } from '../inventory/guard';
import { callerAs, count, freshLab, price, product, receipt, type Lab } from './inventory-w207-helpers';

/** W2-07 · foodcost-06: "last time" on every line, and the fat-finger guard (2× / 50 % / ₪2,000). */
describe('guardLine (pure)', () => {
  it('flags >2× and <50 % of (last + received), and >₪2,000 on the line', () => {
    expect(guardLine({ qty: '29', base: '14', valueAgorot: null })).toEqual(['high']);
    expect(guardLine({ qty: '28', base: '14', valueAgorot: null })).toEqual([]);
    expect(guardLine({ qty: '6.9999', base: '14', valueAgorot: null })).toEqual(['low']);
    expect(guardLine({ qty: '7', base: '14', valueAgorot: null })).toEqual([]);
    expect(guardLine({ qty: '999', base: '10', valueAgorot: 3_396_600 })).toEqual(['high', 'value']);
    expect(guardLine({ qty: '1', base: null, valueAgorot: 200_000 })).toEqual([]);
    expect(guardLine({ qty: '1', base: null, valueAgorot: 200_001 })).toEqual(['value']);
    expect(guardLine({ qty: null, base: '10', valueAgorot: null })).toEqual([]);
  });
});

describe('inventory lines carry last time + flags', () => {
  let A: Lab;
  let trays: string;
  let beef: string;
  let draft: string;
  beforeAll(async () => {
    [A] = (await freshLab(['GA'])) as [Lab];
    trays = await product(A!.t, 'תבניות ביצים', 'תבנית', 'ביצים');
    beef = await product(A!.t, 'אנטריקוט', 'ק״ג', 'בשר');
    await price(A!.t, trays, 40, '34.0000');
    await price(A!.t, beef, 40, '100.0000');
    await count(A!, 20, { [trays]: '8', [beef]: '10' });
    await receipt(A!.t, trays, 'תבנית', 5, '6', null, 'completed');
    draft = await count(A!, 1, { [trays]: '999', [beef]: '4' }, false, 'chef');
  });

  it('prevQty / prevUnit / receivedSince are returned (never prefilled)', async () => {
    const v = await callerAs(A, 'owner').inventory.get({ countId: draft });
    const t = v.lines.find((l) => l.productId === trays)!;
    expect(t).toMatchObject({ prevQty: '8.0000', prevUnit: 'תבנית', receivedSince: '6.0000', expectedQty: '14.0000', qty: '999.0000' });
  });

  it('999 trays: high + value for the owner (with ₪); the chef gets the same flags and valueFlag, no ₪', async () => {
    const owner = await callerAs(A, 'owner').inventory.get({ countId: draft });
    const o = owner.lines.find((l) => l.productId === trays)!;
    expect(o.flags).toEqual(['high', 'value']);
    expect(o.valueAgorot).toBe(3_396_600);
    const chef = await callerAs(A, 'chef').inventory.current();
    const c = chef!.lines.find((l) => l.productId === trays)!;
    expect(c).toMatchObject({ flags: ['high', 'value'], valueFlag: true });
    expect(c).not.toHaveProperty('valueAgorot');
    // 4 kg of beef vs 10 last time: under 50 %.
    expect(chef!.lines.find((l) => l.productId === beef)!.flags).toEqual(['low']);
  });

  it("complete's audit lists the flagged lines and which were confirmed", async () => {
    const { auditLog, and, eq, desc } = await import('@restomatch/db');
    const { db } = await import('./inventory-w207-helpers');
    await callerAs(A, 'owner').inventory.complete({ countId: draft, acceptUncounted: true, confirmedFlags: [trays] });
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, draft), eq(auditLog.action, 'inventory.count_closed'))).orderBy(desc(auditLog.at)).limit(1);
    const flagged = (row!.after as { flaggedLines: unknown[] }).flaggedLines;
    expect(flagged).toHaveLength(2);
    expect(flagged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: trays, flags: ['high', 'value'], confirmed: true }),
        expect.objectContaining({ productId: beef, flags: ['low'], confirmed: false }),
      ]),
    );
  });
});
