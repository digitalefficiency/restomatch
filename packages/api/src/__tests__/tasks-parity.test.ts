import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { foldBadges } from '../tasks/badges';
import { addDiscrepancy, as, fresh, seedStaffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

const agorot = (ils: number) => Math.round(ils * 100);

describe('tasks parity (deep-fix class 5: one ₪ per queue)', () => {
  it('Σ decide ₪ = approvals.queueSummary (the approvals tile), per finance role', async () => {
    const t = await seedStaffed('A');
    await addDiscrepancy(t, { role: 'owner', severity: 'block', delta: '200.00' });
    await addDiscrepancy(t, { role: 'manager', delta: '40.00' });
    await addDiscrepancy(t, { role: 'bookkeeper', type: 'DUPLICATE_INVOICE', delta: '117.00' });
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      const c = as(t, role);
      const [q, { tasks }] = [await c.approvals.queueSummary(), await c.tasks.mine()];
      const d = tasks.find((x) => x.type === 'decision');
      expect(d?.ilsAgorot ?? 0, role).toBe(agorot(q.toDecide.amountIls));
      expect(d?.count ?? 0, role).toBe(q.count);
      expect(d?.blocking ?? 0, role).toBe(q.blockers);
      const others = tasks.filter((x) => x.type === 'waiting_on_others');
      expect(others.reduce((s, x) => s + x.count, 0), role).toBe(q.others.count);
      // The badge is the same task folded: same ₪, same block flag.
      const { badges } = await c.nav.badges();
      expect(badges.approvals?.ilsAgorot ?? 0, role).toBe(d?.ilsAgorot ?? 0);
      expect(badges.approvals?.block ?? false, role).toBe((d?.blocking ?? 0) > 0);
    }
  });

  it("the bookkeeper's view of the whole restaurant = the owner's queueSummary (mine + others)", async () => {
    const t = await seedStaffed('A');
    await addDiscrepancy(t, { role: 'owner', delta: '70.00' });
    await addDiscrepancy(t, { role: 'manager', delta: '30.00' });
    const owner = await as(t, 'owner').approvals.queueSummary();
    const { tasks } = await as(t, 'bookkeeper').tasks.mine();
    const total = tasks.filter((x) => x.type === 'decision' || x.type === 'waiting_on_others').reduce((s, x) => s + x.count, 0);
    expect(total).toBe(owner.count + owner.others.count);
  });

  it('routed info rows count as "לבדיקה" and add no ₪', async () => {
    const t = await seedStaffed('A');
    const before = (await as(t, 'owner').tasks.mine()).tasks.find((x) => x.type === 'decision');
    await addDiscrepancy(t, { role: 'owner', type: 'UNORDERED_ARRIVAL', severity: 'info', delta: '500.00' });
    const after = (await as(t, 'owner').tasks.mine()).tasks.find((x) => x.type === 'decision')!;
    expect(after.count).toBe((before?.count ?? 0) + 1);
    // No ₪ from the info row: never more than before, and still the approvals tile to the agora.
    expect(after.ilsAgorot!).toBeLessThanOrEqual(before?.ilsAgorot ?? 0);
    expect(after.ilsAgorot).toBe(agorot((await as(t, 'owner').approvals.queueSummary()).toDecide.amountIls));
    expect(Number(after.detail?.toReview)).toBe(Number(before?.detail?.toReview ?? 0) + 1);
  });

  it('waiting_on_others never adds into my badge', () => {
    const b = foldBadges([
      { type: 'waiting_on_others', entityId: 'o', title: '', ilsAgorot: 5000, count: 2, blocking: 1, tier: 'T4', tone: 'neutral', due: null, ageDays: null, verb: 'view', deepLink: '/dashboard/approvals', scope: 'others' },
    ]);
    expect(b.approvals).toBeUndefined();
  });
});
