import { ilDate, ilHour } from './dates';

/**
 * A morning brief (06:00 receiver, 09:00 orders, 10:00 late trucks) is PERISHABLE:
 * if quiet hours or Shabbat push its earliest allowed send past 12:00 of the same
 * Israel day, it is skipped and logged `skipped: quiet`, never queued (a Saturday
 * 06:00 truck list delivered at 21:00 is noise). `nextAllowedAt` comes from G-06's
 * `nextAllowedMinute(now)` (#173 `sendWindow.ts`) — this file holds no quiet-hours
 * rule of its own, only the "is it still worth it" cut.
 */
export const PERISHABLE_CUTOFF_HOUR = 12;

export function isPerishableSkip(slotAt: Date, nextAllowedAt: Date): boolean {
  if (nextAllowedAt.getTime() <= slotAt.getTime()) return false;
  if (ilDate(nextAllowedAt) !== ilDate(slotAt)) return true;
  return ilHour(nextAllowedAt) >= PERISHABLE_CUTOFF_HOUR;
}
