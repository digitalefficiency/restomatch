import { sql } from '@restomatch/db';

type SQL = ReturnType<typeof sql>;
import { CLAIM_ANSWER_DAYS, NEVER_CLAIMABLE_TYPES, isNeverClaimable } from '../lib/claims';

/**
 * AU-03 · the ONE "waiting on the supplier too long" rule (catalogue A12).
 *
 * Before AU-03 the 08:30 reminder counted every awaiting claim (claimed,
 * letter_sent, acknowledged) and the web banner counted only `letter_sent`
 * claims by the supplier's latest letter — so the e-mail and the home row
 * named different ₪. Now membership is decided PER CLAIM by this predicate,
 * in TS (`isAwaitingChase`) and SQL (`awaitingChaseSql`), and both run the
 * shared `OVERDUE_BOUNDARY_CASES`. Display may group per supplier; ₪ is always
 * summed per claim. The browser keeps a pure mirror (`isAwaitingChaseWeb`
 * in apps/web/app/dashboard/recovery/logic.ts) that a parity test locks.
 *
 * A claim is awaiting a chase when:
 *  • its status is `claimed`, `letter_sent`, or `acknowledged` (the last only
 *    when the `chaseAcknowledged` option is on — AD5, default on);
 *  • something is still outstanding (amount > credited);
 *  • its discrepancy type is not one the owner never asks back;
 *  • MORE than CLAIM_ANSWER_DAYS whole calendar days (restaurant time zone,
 *    Asia/Jerusalem by default) passed since COALESCE(letter_sent_at, claimed_at).
 *
 * A `claimed` claim has no letter: it is reported as UNSENT ("טרם נשלח מכתב"),
 * never as "no reply" — a reminder to a supplier who never got the letter is wrong.
 */

export const CHASE_STATUSES = ['claimed', 'letter_sent', 'acknowledged'] as const;
export type ChaseStatus = (typeof CHASE_STATUSES)[number];

export interface ChaseOptions {
  /** AD5: an acknowledged claim with no credit yet is chased (softer draft). Default true. */
  chaseAcknowledged?: boolean;
}

/**
 * Interim automation options until AU-01's `automationOption(settings, key)`
 * lands (AU-01 AC 2 registry rows, both default true). One read site:
 * `chaseOptionsFor` in reminders.ts.
 */
export const CHASE_DEFAULTS = { chaseAcknowledged: true, recoveryBookkeeper: true } as const;

export interface ChaseClaim {
  status: string;
  /** Still owed, integer agorot (amount − credited). */
  outstandingAgorot: number;
  letterSentAt: string | null;
  claimedAt: string;
  /** The discrepancy type; a never-claimable type is never chased. Unknown → treated as claimable. */
  discrepancyType?: string | null;
}

/** Whole calendar days between two instants in a time zone (b − a). */
export function calendarDaysBetween(aIso: string, bIso: string, tz = 'Asia/Jerusalem'): number {
  return dayNumber(bIso, tz) - dayNumber(aIso, tz);
}

function dayNumber(iso: string, tz: string): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
    .split('-')
    .map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** The waiting clock: from the letter, or from the claim when no letter went out. */
export function chaseClockFrom(c: Pick<ChaseClaim, 'letterSentAt' | 'claimedAt'>): string {
  return c.letterSentAt ?? c.claimedAt;
}

/** More than CLAIM_ANSWER_DAYS whole calendar days since `fromIso` (the boundary rule alone). */
export function isPastAnswerWindow(fromIso: string, nowIso: string, tz = 'Asia/Jerusalem'): boolean {
  return calendarDaysBetween(fromIso, nowIso, tz) > CLAIM_ANSWER_DAYS;
}

export function isAwaitingChase(c: ChaseClaim, nowIso: string, opts: ChaseOptions & { tz?: string } = {}): boolean {
  const chaseAck = opts.chaseAcknowledged ?? CHASE_DEFAULTS.chaseAcknowledged;
  if (!(CHASE_STATUSES as readonly string[]).includes(c.status)) return false;
  if (c.status === 'acknowledged' && !chaseAck) return false;
  if (!(c.outstandingAgorot > 0)) return false;
  if (c.discrepancyType && isNeverClaimable(c.discrepancyType)) return false;
  return isPastAnswerWindow(chaseClockFrom(c), nowIso, opts.tz);
}

/** How a chased claim is shown: never-sent letter, no reply to a letter, or acknowledged without credit. */
export type ChaseKind = 'unsent' | 'no_reply' | 'acknowledged';
export function chaseKindOf(status: string): ChaseKind {
  if (status === 'claimed') return 'unsent';
  if (status === 'acknowledged') return 'acknowledged';
  return 'no_reply';
}

/**
 * The SQL twin of `isAwaitingChase` (alias c = recovery_claims, d = its
 * discrepancy; `tz` = the restaurant time zone expression).
 */
export function awaitingChaseSql(now: Date, tz: SQL, opts: ChaseOptions = {}): SQL {
  const chaseAck = opts.chaseAcknowledged ?? CHASE_DEFAULTS.chaseAcknowledged;
  const statuses = CHASE_STATUSES.filter((s) => chaseAck || s !== 'acknowledged');
  return sql`(c.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
    AND c.amount_agorot > c.credited_agorot
    AND d.type NOT IN (${sql.join(NEVER_CLAIMABLE_TYPES.map((t) => sql`${t}`), sql`, `)})
    AND ${pastAnswerWindowSql(now, tz)})`;
}

/** The boundary rule alone in SQL (alias c): more than CLAIM_ANSWER_DAYS whole calendar days. */
export function pastAnswerWindowSql(now: Date, tz: SQL): SQL {
  return sql`((${now.toISOString()}::timestamptz AT TIME ZONE ${tz})::date
    - (COALESCE(c.letter_sent_at, c.claimed_at) AT TIME ZONE ${tz})::date) > ${CLAIM_ANSWER_DAYS}`;
}

/**
 * Owner rule (signed 7.11): the first reminder after 7 full days (day 8), then
 * every REMIND_EVERY_DAYS (7) — counted in whole calendar days like the
 * overdue boundary, never as an instant interval (an 08:30 run a minute
 * earlier than last week's must not slip a week). No day-3 courtesy note.
 */
export const REMIND_EVERY_CALENDAR_DAYS = 7;

export function isRechaseDue(lastReminderAt: string | null, nowIso: string, tz = 'Asia/Jerusalem'): boolean {
  return lastReminderAt == null || calendarDaysBetween(lastReminderAt, nowIso, tz) >= REMIND_EVERY_CALENDAR_DAYS;
}

/** SQL twin of `isRechaseDue` (alias c). */
export function rechaseDueSql(now: Date, tz: SQL): SQL {
  return sql`(c.last_reminder_at IS NULL
    OR ((${now.toISOString()}::timestamptz AT TIME ZONE ${tz})::date
        - (c.last_reminder_at AT TIME ZONE ${tz})::date) >= ${REMIND_EVERY_CALENDAR_DAYS})`;
}
