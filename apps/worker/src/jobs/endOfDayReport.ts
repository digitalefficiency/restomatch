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
import {
  and,
  count,
  createDb,
  discrepancies,
  eq,
  gte,
  inArray,
  restaurants,
  sql,
} from '@restomatch/db';
import { makeWorker } from '../queue';
import { appBaseUrl, formatIlsAmount, formatIlDate, startOfIlDay } from '../lib/notifyHelpers';

export interface EndOfDayReportJob {
  /** When omitted, runs for ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

/** Discrepancies in these states are still recoverable money ("open credits"). */
const OPEN_STATES = ['open', 'escalated'] as const;

export function startEndOfDayReportWorker() {
  return makeWorker<EndOfDayReportJob>('end-of-day-report', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
    const startToday = startOfIlDay(now);
    const todayKey = startToday.toISOString().slice(0, 10);

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

      for (const recipient of recipients) {
        const { deduped } = await enqueueNotification(db, {
          restaurantId: restaurant.id,
          channel: 'email',
          target: recipient.email,
          subject: email.subject,
          body: email.text,
          html: email.html,
          relatedEntityType: 'restaurant',
          relatedEntityId: restaurant.id,
          dedupeKey: `eod-report:${restaurant.id}:${todayKey}:${recipient.email}`,
        });
        if (!deduped) sent += 1;
      }
    }

    console.log(
      `[end-of-day-report] date=${todayKey} restaurants=${restaurantRows.length} sent=${sent} skipped=${skipped}`,
    );
    return { date: todayKey, sent, skipped };
  });
}
