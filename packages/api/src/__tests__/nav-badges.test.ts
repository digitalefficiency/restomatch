import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, recoveryClaims, restaurants, sql } from '@restomatch/db';
import { foldBadges } from '../tasks/badges';
import type { Task } from '../tasks/types';
import { addDiscrepancy, as, db, fresh, seedStaffed } from './tasks-fixtures';

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

  it('the claims badge ₪ is the figure on the page it opens (recovery hero "זיכויים פתוחים")', async () => {
    const a = await seedStaffed('A');
    await db
      .update(restaurants)
      .set({ settings: sql`jsonb_set(coalesce(${restaurants.settings}, '{}'::jsonb), '{features}', coalesce(${restaurants.settings} -> 'features', '{}'::jsonb) || '{"recovery": true}'::jsonb)` })
      .where(eq(restaurants.id, a.restaurantId));
    const d1 = await addDiscrepancy(a, { delta: '300.00' });
    const d2 = await addDiscrepancy(a, { delta: '500.00' });
    const d3 = await addDiscrepancy(a, { delta: '200.00' });
    const old = new Date(Date.now() - 30 * 86_400_000);
    await db.insert(recoveryClaims).values([
      // Unsent (a "send" task) and one sent long ago, partly credited (a "match the credit" task).
      { restaurantId: a.restaurantId, discrepancyId: d1.id, supplierId: a.supplierId, invoiceId: a.invoiceId, amountAgorot: 30_000 },
      { restaurantId: a.restaurantId, discrepancyId: d2.id, supplierId: a.supplierId, invoiceId: a.invoiceId, amountAgorot: 50_000, creditedAgorot: 10_000, status: 'letter_sent', claimedAt: old },
      // Open but in no task (acknowledged yesterday): on the page's figure, not in the tasks' sum.
      { restaurantId: a.restaurantId, discrepancyId: d3.id, supplierId: a.supplierId, invoiceId: a.invoiceId, amountAgorot: 20_000, status: 'acknowledged', claimedAt: new Date(Date.now() - 86_400_000) },
    ]);
    const owner = as(a, 'owner');
    const [{ badges }, { summary }] = await Promise.all([owner.nav.badges(), owner.recovery.summary()]);
    expect(summary.outstandingAgorot).toBeGreaterThan(0);
    expect(badges.claims).toMatchObject({ ilsAgorot: summary.outstandingAgorot, money: 'owed' });
    // …which is not what the tasks alone add up to (the old badge figure).
    const { tasks } = await owner.tasks.mine();
    const taskSum = tasks.filter((x) => x.type === 'claim_to_send' || x.type === 'credit_to_match').reduce((n, x) => n + (x.ilsAgorot ?? 0), 0);
    expect(taskSum).not.toBe(summary.outstandingAgorot);
  });
});
