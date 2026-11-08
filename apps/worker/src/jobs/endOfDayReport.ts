/**
 * end-of-day-report — 19:00 IL digest emailed to each restaurant's managers.
 *
 * Summarizes the day's money picture, led by OPEN CREDITS — discrepancies still
 * `open`/`escalated` whose ₪ delta is recoverable from the supplier — plus what
 * was caught today and how many items await a decision. Quiet days (no open
 * credits and nothing caught) are skipped to avoid inbox noise.
 *
 * Detection only: it reads discrepancies and enqueues notifications; delivery
 * happens through outbox-dispatch.
 */
import {
  enqueueNotification,
  endOfDayReportEmail,
  recipientsForRestaurant,
} from '@restomatch/api';
import { and, count, discrepancies, eq, gte, inArray, lt, notificationsOutbox, restaurants, sql } from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl, formatIlsAmount, formatIlDate, ilDateKey, startOfIlDay } from '../lib/notifyHelpers';
import { jobDb } from '../db';

export interface EndOfDayReportJob {
  /** When omitted, runs for ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

/** Discrepancies in these states are still recoverable money ("open credits"). */
const OPEN_STATES = ['open', 'escalated'] as const;

export function startEndOfDayReportWorker() {
  return makeWorker<EndOfDayReportJob>('end-of-day-report', processEndOfDayReport);
}

/** Before this Israel hour a run is a CATCH-UP of the previous evening's 19:00 slot. */
export const EOD_CATCHUP_BEFORE_HOUR = 6;

/**
 * The Israel day an end-of-day report is ABOUT. A 19:00 run reports its own day; a
 * catch-up that runs after Israel midnight (the serverless runner's window tail,
 * 00:00–06:00 IL) reports the day the slot belonged to — never the new day, which
 * would show "nothing caught today" and take the next evening's dedupe key.
 */
export function eodReportDay(now: Date): { startOfDay: Date; endOfDay: Date; dayKey: string } {
  let start = startOfIlDay(now);
  const ilHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
  if (ilHour < EOD_CATCHUP_BEFORE_HOUR) start = startOfIlDay(new Date(start.getTime() - 1));
  // +36 h always lands in the next IL day (days are 23–25 h around DST).
  const endOfDay = startOfIlDay(new Date(start.getTime() + 36 * 3600_000));
  // Midday of the report day: its Israel date, whatever the DST offset.
  return { startOfDay: start, endOfDay, dayKey: ilDateKey(new Date(start.getTime() + 12 * 3600_000)) };
}

/** `eod-report:v2:<rid>:<IL report day>:<email>`. */
export function eodDedupeKey(restaurantId: string, dayKey: string, email: string): string {
  return `eod-report:v2:${restaurantId}:${dayKey}:${email}`;
}

/**
 * DEPLOY-DAY GUARD (one-time; delete once the fix has been deployed a full day).
 * The dedupe key used to carry the UTC date of Israel midnight (always the PREVIOUS
 * Israel date); it now carries the Israel report day. A same-day re-run after the
 * deploy would get a new key and send twice, so a recipient who already has the
 * old-format row for this report day is skipped.
 */
export function legacyEodKey(restaurantId: string, startOfReportDay: Date, email: string): string {
  return `eod-report:${restaurantId}:${startOfReportDay.toISOString().slice(0, 10)}:${email}`;
}

/** The end-of-day-report job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processEndOfDayReport(job: WorkerJob<EndOfDayReportJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
  const { startOfDay: startToday, endOfDay, dayKey: todayKey } = eodReportDay(now);

  const restaurantRows = job.data.restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select().from(restaurants);

  let sent = 0;
  let skipped = 0;

  for (const restaurant of restaurantRows) {
    // Open credits: unresolved discrepancies with recoverable ₪.
    const [openAgg] = await db
      .select({
        cnt: count(discrepancies.id),
        total: sql<string>`coalesce(sum(abs(${discrepancies.deltaAmount})), 0)`,
      })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.restaurantId, restaurant.id),
          inArray(discrepancies.resolutionStatus, [...OPEN_STATES]),
        ),
      );

    // What was flagged today.
    const [todayAgg] = await db
      .select({
        cnt: count(discrepancies.id),
        total: sql<string>`coalesce(sum(abs(${discrepancies.deltaAmount})), 0)`,
      })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.restaurantId, restaurant.id),
          gte(discrepancies.createdAt, startToday),
          lt(discrepancies.createdAt, endOfDay),
        ),
      );

    const openCount = Number(openAgg?.cnt ?? 0);
    const todayCount = Number(todayAgg?.cnt ?? 0);

    // Quiet day → skip (no open credits, nothing caught today).
    if (openCount === 0 && todayCount === 0) {
      skipped += 1;
      continue;
    }

    // Items awaiting a manager decision (subset of open).
    const [pendingAgg] = await db
      .select({ cnt: count(discrepancies.id) })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.restaurantId, restaurant.id),
          eq(discrepancies.resolutionStatus, 'open'),
        ),
      );

    const recipients = await recipientsForRestaurant(db, restaurant.id);
    if (recipients.length === 0) {
      skipped += 1;
      continue;
    }

    const email = endOfDayReportEmail({
      dateLabel: formatIlDate(startToday).split(',')[0]?.trim() ?? todayKey,
      openCreditsCount: openCount,
      openCreditsIls: formatIlsAmount(Number(openAgg?.total ?? 0)),
      todayCaughtCount: todayCount,
      todayCaughtIls: formatIlsAmount(Number(todayAgg?.total ?? 0)),
      pendingApprovals: Number(pendingAgg?.cnt ?? 0),
      approvalsUrl: `${appBaseUrl()}/dashboard/approvals`,
    });

    const legacyRows = await db
      .select({ key: notificationsOutbox.dedupeKey })
      .from(notificationsOutbox)
      .where(
        and(
          eq(notificationsOutbox.restaurantId, restaurant.id),
          // Old format only: exactly the legacy key's prefix (a v2 key never starts with it).
          sql`${notificationsOutbox.dedupeKey} like ${`eod-report:${restaurant.id}:${startToday.toISOString().slice(0, 10)}:%`}`,
        ),
      );
    const legacy = new Set(legacyRows.map((r) => r.key));

    for (const recipient of recipients) {
      if (legacy.has(legacyEodKey(restaurant.id, startToday, recipient.email))) continue;
      const { deduped } = await enqueueNotification(db, {
        restaurantId: restaurant.id,
        channel: 'email',
        target: recipient.email,
        subject: email.subject,
        body: email.text,
        html: email.html,
        relatedEntityType: 'restaurant',
        relatedEntityId: restaurant.id,
        // `v2`: the Israel report day. The prefix keeps it disjoint from the old
        // UTC-date keys (old "day D" carried D-1, the same text as a new "day D-1").
        dedupeKey: eodDedupeKey(restaurant.id, todayKey, recipient.email),
      });
      if (!deduped) sent += 1;
    }
  }

  console.log(
    `[end-of-day-report] date=${todayKey} restaurants=${restaurantRows.length} sent=${sent} skipped=${skipped}`,
  );
  return { date: todayKey, sent, skipped };
}
