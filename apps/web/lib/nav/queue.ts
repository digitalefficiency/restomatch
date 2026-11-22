import type { UserRole } from '@restomatch/db';
import type { BadgeValueLike } from './badgeLook';

/**
 * לטיפולי, "my queue" (sidebar SPEC §4.1 top rows, §5.3, §7.4): the shell's
 * second top item, right after בית. It is a SHELL item, not a registry entry:
 * nav-registry.test pins the registry, and in phase 1 the queue is a section
 * of the home page, not a page of its own. Its number is `tasks.mine`, the
 * same source as the home "מחכה לך" list and the bell footer, so the menu and
 * the page can never disagree.
 */

/** The item key (labels, hotkey `G Q`, badge map). */
export const QUEUE_KEY = 'queue';

/**
 * Phase 1: the home "מחכה לך" section (`id="needs-you-title"` in
 * app/dashboard/home/needs-you.tsx). Phase 2 moves it to `/dashboard/queue`.
 */
export const QUEUE_HREF = '/dashboard#needs-you-title';

const QUEUE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['owner', 'manager', 'bookkeeper']);

/**
 * Owner, manager and bookkeeper get לטיפולי. Chef and receiver work from a
 * flat rail whose home already is their list of today's jobs.
 */
export function queueVisible(role: UserRole): boolean {
  return QUEUE_ROLES.has(role);
}

/** The fields of a `tasks.mine` row the queue badge reads (a full `Task` fits). */
export interface QueueTaskLike {
  scope: 'mine' | 'others';
  count: number;
  blocking: number;
}

/**
 * The לטיפולי badge: the summed count of MY rows (rows waiting on someone else
 * are not mine to do), danger only when one of them blocks a payment. Count
 * only, never ₪: the queue mixes money and capture jobs, and the ₪ lives on
 * the money items themselves. Undefined (no pill) while loading, on a failed
 * read and when nothing is waiting: §6 never shows "0".
 */
export function queueBadge(tasks: ReadonlyArray<QueueTaskLike> | undefined): BadgeValueLike | undefined {
  if (!tasks) return undefined;
  let count = 0;
  let block = false;
  for (const t of tasks) {
    if (t.scope !== 'mine' || !Number.isFinite(t.count) || t.count <= 0) continue;
    count += t.count;
    if (t.blocking > 0) block = true;
  }
  if (count <= 0) return undefined;
  return { count, ilsAgorot: null, block, tone: block ? 'danger' : 'neutral' };
}
