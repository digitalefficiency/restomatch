import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { foldBadges } from '../tasks/badges';
import type { Task } from '../tasks/types';
import { addDiscrepancy, as, fresh, seedStaffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

const task = (p: Partial<Task>): Task => ({
  type: 'decision', entityId: 'x', title: '', ilsAgorot: 0, count: 0, blocking: 0, tier: 'T2', tone: 'warn',
  due: null, ageDays: null, verb: 'decide', deepLink: '/dashboard/approvals', scope: 'mine', ...p,
});

describe('nav.badges (W2-08 §5.3)', () => {
  it('hidden at 0: an empty queue sends no badge', () => {
    expect(foldBadges([task({ count: 0 })])).toEqual({});
    expect(foldBadges([], { priceAlerts: 0 })).toEqual({});
  });

  it('the block flag (danger) only when something blocks', () => {
    expect(foldBadges([task({ count: 2, ilsAgorot: 100 })]).approvals).toMatchObject({ block: false, tone: 'warn', ilsAgorot: 100 });
    expect(foldBadges([task({ count: 2, blocking: 1 })]).approvals).toMatchObject({ block: true, tone: 'danger' });
  });

  it('counts are uncapped on the server (the UI shows 99+); capture items carry no ₪', () => {
    const b = foldBadges([task({ type: 'delivery_due', count: 150, ilsAgorot: 999 })]);
    expect(b.receiving).toEqual({ count: 150, ilsAgorot: null, block: false, tone: 'warn' });
  });

  it('price alerts are neutral (W2-12 materiality pending)', () => {
    expect(foldBadges([], { priceAlerts: 4 }).priceAlerts).toEqual({ count: 4, ilsAgorot: null, block: false, tone: 'neutral' });
  });

  it('isolation: A badges never include B queues; staff get counts only', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await addDiscrepancy(b, { severity: 'block', delta: '777.00' });
    const ownerA = await as(a, 'owner').nav.badges();
    expect(ownerA.badges.approvals?.block ?? false).toBe(false);
    const rec = await as(a, 'receiver').nav.badges();
    expect(Object.keys(rec.badges).every((k) => k === 'receiving')).toBe(true);
  });
});
