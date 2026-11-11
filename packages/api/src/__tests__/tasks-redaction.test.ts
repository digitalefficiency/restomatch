import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import superjson from 'superjson';
import { redactTask } from '../tasks/collect';
import { addDiscrepancy, as, fresh, seedStaffed } from './tasks-fixtures';

beforeEach(fresh);
afterAll(fresh);

describe('tasks redaction (decision 6: no purchase or leak ₪ for staff)', () => {
  it('receiver and chef payloads carry no ₪ — tasks.mine and nav.badges', async () => {
    const t = await seedStaffed('A');
    await addDiscrepancy(t, { severity: 'block', delta: '321.00' });
    for (const role of ['receiver', 'chef'] as const) {
      const c = as(t, role);
      const mine = await c.tasks.mine();
      const badges = await c.nav.badges();
      for (const x of mine.tasks) expect(x.ilsAgorot, role).toBeNull();
      for (const b of Object.values(badges.badges)) expect(b!.ilsAgorot, role).toBeNull();
      const wire = superjson.stringify({ mine, badges });
      expect(wire).not.toMatch(/₪|32100|321\.00|Agorot":\s*\d/);
    }
  });

  it('redactTask strips ₪ and side amounts, keeps counts', () => {
    const r = redactTask({
      type: 'decision', entityId: 'd', title: 'decision', ilsAgorot: 1234, count: 3, blocking: 1, tier: 'T2', tone: 'danger',
      due: null, ageDays: 2, verb: 'decide', deepLink: '/dashboard/approvals', scope: 'mine',
      detail: { toReview: 1, duplicateAgorot: 500, vatAgorot: 100 },
    });
    expect(r.ilsAgorot).toBeNull();
    expect(r.detail).toEqual({ toReview: 1 });
    expect(r.count).toBe(3);
  });
});
