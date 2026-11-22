import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import type { Task } from '../../components/notifications/model';
import { ALL_ROLES } from '../../roles';
import { badgeLook } from '../badgeLook';
import { DEFAULT_ROUTE_BADGES } from '../badges';
import { QUEUE_HREF, QUEUE_KEY, queueBadge, queueVisible } from '../queue';
import { REGISTRY, routeByKey } from '../registry';
import { BADGE_KEYS } from '../types';
import { canOpenPath } from '../visibility';

/** A full `tasks.mine` row (the real tRPC shape), so the tests also prove a Task[] fits queueBadge. */
const task = (over: Partial<Task> = {}): Task => ({
  type: 'decision',
  entityId: 'decision:mine',
  title: 'decision',
  ilsAgorot: null,
  count: 1,
  blocking: 0,
  tier: 'T2',
  tone: 'neutral',
  due: null,
  ageDays: null,
  verb: 'decide',
  deepLink: '/dashboard/approvals',
  scope: 'mine',
  ...over,
});

describe('queue · the לטיפולי item', () => {
  it('is the shell key `queue` and lands on the home "מחכה לך" section (phase 1)', () => {
    expect(QUEUE_KEY).toBe('queue');
    expect(QUEUE_HREF).toBe('/dashboard#needs-you-title');
  });

  it('is a shell item, never a registry entry or a nav.badges source (its key cannot collide)', () => {
    expect(routeByKey(QUEUE_KEY)).toBeUndefined();
    expect(REGISTRY.some((d) => d.key === QUEUE_KEY)).toBe(false);
    expect(BADGE_KEYS).not.toContain(QUEUE_KEY);
    expect(Object.keys(DEFAULT_ROUTE_BADGES)).not.toContain(QUEUE_KEY);
  });

  it('the home path it lands on is the registry home, open to every role that sees it', () => {
    const path = QUEUE_HREF.split('#')[0]!;
    expect(routeByKey('home')?.path).toBe(path);
    for (const role of ALL_ROLES.filter((r) => queueVisible(r))) expect(canOpenPath(role, path), role).toBe(true);
  });

  it('its anchor exists on the home page', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'app', 'dashboard', 'home', 'needs-you.tsx'), 'utf8');
    const anchor = QUEUE_HREF.split('#')[1]!;
    expect(src).toContain(`id="${anchor}"`);
  });

  it('shows for owner, manager and bookkeeper only', () => {
    const shown = ALL_ROLES.filter((r) => queueVisible(r));
    expect(shown.sort()).toEqual<UserRole[]>(['bookkeeper', 'manager', 'owner']);
    expect(queueVisible('chef')).toBe(false);
    expect(queueVisible('receiver')).toBe(false);
  });
});

describe('queueBadge · count + block from tasks.mine (§5.3)', () => {
  it('no data (loading, failed read) → no badge', () => {
    expect(queueBadge(undefined)).toBeUndefined();
  });

  it('nothing waiting on me → no badge (never "0")', () => {
    expect(queueBadge([])).toBeUndefined();
    expect(queueBadge([task({ count: 0 })])).toBeUndefined();
    expect(queueBadge([task({ scope: 'others', count: 4, withRole: 'manager' })])).toBeUndefined();
  });

  it('sums the count of my rows only, skipping empty and broken rows', () => {
    const tasks = [
      task({ count: 4 }),
      task({ type: 'delivery_due', count: 3 }),
      task({ scope: 'others', count: 7, withRole: 'manager' }),
      task({ count: 0 }),
      task({ count: -1 }),
      task({ count: Number.NaN }),
    ];
    expect(queueBadge(tasks)).toEqual({ count: 7, ilsAgorot: null, block: false, tone: 'neutral' });
  });

  it('turns danger when one of MY rows blocks a payment', () => {
    expect(queueBadge([task({ count: 4, blocking: 2, tone: 'danger' }), task({ count: 6 })])).toEqual({
      count: 10,
      ilsAgorot: null,
      block: true,
      tone: 'danger',
    });
  });

  it('a broken row (no count, yet "blocking") neither counts nor blocks, as the server folds nav.badges', () => {
    expect(queueBadge([task({ count: 3 }), task({ count: 0, blocking: 2 })])).toEqual({ count: 3, ilsAgorot: null, block: false, tone: 'neutral' });
    expect(queueBadge([task({ count: 0, blocking: 5 })])).toBeUndefined();
  });

  it("a blocking row waiting on someone else does not make my queue danger", () => {
    expect(queueBadge([task({ count: 2 }), task({ scope: 'others', count: 3, blocking: 3, withRole: 'owner' })])).toMatchObject({
      count: 2,
      block: false,
      tone: 'neutral',
    });
  });

  it('never carries ₪, even when the tasks do', () => {
    expect(queueBadge([task({ count: 4, ilsAgorot: 29_600 })])?.ilsAgorot).toBeNull();
  });

  it('reads as a count pill with the danger dot (§4.1: count + danger dot)', () => {
    const look = badgeLook(queueBadge([task({ count: 10, blocking: 2 })]), { fieldRole: false });
    expect(look).toMatchObject({ pill: 'count', count: 10, innerDot: true, railDot: 'danger', agorot: null, t2: null });
  });
});
