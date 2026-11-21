import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TASK_TYPES } from '../tasks/types';
import { rankTasks } from '../tasks/rank';
import type { Task } from '../tasks/types';
import { addDiscrepancy, as, fresh, seedStaffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

const base: Task = {
  type: 'decision', entityId: 'x', title: 'x', ilsAgorot: 0, count: 1, blocking: 0, tier: 'T2', tone: 'warn',
  due: null, ageDays: null, verb: 'decide', deepLink: '/dashboard/approvals', scope: 'mine',
};

describe('tasks.mine (W2-08 §5.1)', () => {
  it('the owner gets the decision task with ₪, blockers, an age and a deep link (never the home)', async () => {
    const t = await seedStaffed('A');
    await addDiscrepancy(t, { severity: 'block', delta: '120.00' });
    const { tasks, failed } = await as(t, 'owner').tasks.mine();
    expect(failed).toEqual([]);
    const d = tasks.find((x) => x.type === 'decision')!;
    expect(d.scope).toBe('mine');
    expect(d.blocking).toBeGreaterThanOrEqual(1);
    expect(d.tone).toBe('danger');
    expect(d.ilsAgorot).toBeGreaterThan(0);
    expect(d.ageDays).toBe(0);
    expect(d.deepLink).toMatch(/^\/dashboard\/approvals/);
    for (const x of tasks) {
      expect(TASK_TYPES).toContain(x.type);
      expect(x.deepLink).not.toBe('/dashboard');
    }
  });

  it("the manager's empty queue names what waits on others (scope 'others', with whom) — not 'all clear'", async () => {
    const t = await seedStaffed('A');
    await addDiscrepancy(t, { role: 'owner', delta: '50.00' });
    const r = await as(t, 'manager').tasks.mine();
    const others = r.tasks.filter((x) => x.scope === 'others');
    expect(others.some((x) => x.type === 'waiting_on_others' && x.withRole === 'owner')).toBe(true);
    expect(r.restaurantClear).toBe(false);
  });

  it('A sees only A tasks (isolation)', async () => {
    const a = await seedStaffed('A');
    const b = await seedStaffed('B');
    await addDiscrepancy(b, { severity: 'block', delta: '999.00' });
    const mineA = await as(a, 'owner').tasks.mine();
    const mineB = await as(b, 'owner').tasks.mine();
    const dA = mineA.tasks.find((x) => x.type === 'decision');
    const dB = mineB.tasks.find((x) => x.type === 'decision')!;
    expect(dA?.ilsAgorot ?? 0).toBeLessThan(dB.ilsAgorot!);
    expect((dA?.blocking ?? 0)).toBe(0);
  });

  it('a role argument other than my own is refused, never widened', async () => {
    const t = await seedStaffed('A');
    const r = await as(t, 'receiver').tasks.mine({ role: 'owner' });
    expect(r.tasks).toEqual([]);
    expect(r.failed).toEqual(['role']);
  });

  it('the receiver gets the deliveries task (count only); the chef reads no money source', async () => {
    const t = await seedStaffed('A');
    const rec = await as(t, 'receiver').tasks.mine();
    expect(rec.failed).toEqual([]);
    expect(rec.tasks.map((x) => x.type).every((x) => x === 'delivery_due' || x === 'delivery_late')).toBe(true);
    const chef = await as(t, 'chef').tasks.mine();
    expect(chef.failed).toEqual([]);
    expect(chef.tasks.some((x) => x.type === 'decision' || x.type === 'claim_to_send')).toBe(false);
  });

  it('ranks block > due today > age > ₪, mine before others', () => {
    const today = '2026-10-25';
    const r = rankTasks(
      [
        { ...base, entityId: 'others', scope: 'others', blocking: 3 },
        { ...base, entityId: 'old', ageDays: 9, ilsAgorot: 1 },
        { ...base, entityId: 'today', due: today },
        { ...base, entityId: 'block', blocking: 1, ageDays: 0 },
        { ...base, entityId: 'rich', ageDays: 9, ilsAgorot: 99_999 },
      ],
      today,
    );
    expect(r.map((x) => x.entityId)).toEqual(['block', 'today', 'rich', 'old', 'others']);
  });
});
