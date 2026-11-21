import type { Task } from './types';

const TONE_RANK = { danger: 0, warn: 1, neutral: 2 } as const;

/**
 * ₪ × urgency (W2-08 §5.1): a block first, then what is due today (or late),
 * then the oldest, then the larger ₪. `mine` always before `others`.
 */
export function rankTasks(tasks: readonly Task[], today: string): Task[] {
  const dueNow = (t: Task) => (t.due !== null && t.due <= today ? 0 : 1);
  return [...tasks].sort(
    (a, b) =>
      (a.scope === 'mine' ? 0 : 1) - (b.scope === 'mine' ? 0 : 1) ||
      (a.blocking > 0 ? 0 : 1) - (b.blocking > 0 ? 0 : 1) ||
      dueNow(a) - dueNow(b) ||
      TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
      (b.ageDays ?? -1) - (a.ageDays ?? -1) ||
      (b.ilsAgorot ?? 0) - (a.ilsAgorot ?? 0) ||
      a.entityId.localeCompare(b.entityId),
  );
}

/** Whole Israel days between two instants (b − a), DST-safe. */
export function israelDay(d: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    typeof d === 'string' ? new Date(d) : d,
  );
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

export const toAgorot = (ils: number): number => Math.round(ils * 100);
