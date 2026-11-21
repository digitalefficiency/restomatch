/**
 * Supplier chase cadence for credit requests (H-05, reconciled with the owner
 * rule "a credit request is overdue after 7 days", owner 31.10).
 *
 * IMPLEMENTATION-PLAN §H-05 said "chase drafts on days 3/7/14". That conflicts
 * with the 7-day rule (a day-3 reminder would chase a request that is not late
 * yet). Default, until the owner answers (H-05a spec correction 6, option א):
 *   - nothing before the request is overdue (calendar days > OVERDUE_DAYS, the
 *     same rule as overdueSql, the tracker badge and recoveryReminders);
 *   - then one reminder, and again every REMIND_EVERY_DAYS;
 *   - the day-3 courtesy note exists only behind CHASE_COURTESY_DAY3 (off) and
 *     is never worded as late.
 * Every chase is a DRAFT awaiting a manager's tap (owner decision 16); nothing
 * is sent to a supplier on its own.
 */
import { OVERDUE_DAYS, REMIND_EVERY_DAYS } from '../../recovery/service';
import { calendarDaysBetween, DEFAULT_TZ } from './calendar';

/** Owner question (option ב). Off until the owner says otherwise. */
export const CHASE_COURTESY_DAY3 = false;
export const COURTESY_DAY = 3;

export type ChaseStep =
  | { kind: 'courtesy'; ageDays: number }
  | { kind: 'reminder'; ageDays: number; nth: number };

export interface ChaseInput {
  /** COALESCE(letter_sent_at, claimed_at). */
  sentAt: Date;
  now: Date;
  /** recovery_claims.last_reminder_at. */
  lastReminderAt: Date | null;
  /** Reminders already drafted for this request (0 when none). */
  remindersSoFar: number;
  /** A courtesy note was already drafted. */
  courtesyDrafted?: boolean;
  tz?: string;
  courtesyDay3?: boolean;
}

/** Which chase draft (if any) is due now. */
export function chaseStepDue(input: ChaseInput): ChaseStep | null {
  const tz = input.tz ?? DEFAULT_TZ;
  const ageDays = calendarDaysBetween(input.sentAt, input.now, tz);
  const overdue = ageDays > OVERDUE_DAYS;

  if (!overdue) {
    const courtesyOn = input.courtesyDay3 ?? CHASE_COURTESY_DAY3;
    if (courtesyOn && ageDays >= COURTESY_DAY && !input.courtesyDrafted && input.remindersSoFar === 0) {
      return { kind: 'courtesy', ageDays };
    }
    return null;
  }

  // Same spacing rule as recoveryReminders: not again within REMIND_EVERY_DAYS.
  if (input.lastReminderAt && input.now.getTime() - input.lastReminderAt.getTime() < REMIND_EVERY_DAYS * 86_400_000) {
    return null;
  }
  return { kind: 'reminder', ageDays, nth: input.remindersSoFar + 1 };
}
