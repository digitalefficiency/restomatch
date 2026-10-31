/**
 * end-of-day-report — 19:00 IL digest emailed to each restaurant's managers.
 *
 * Summarizes the day's money picture, led by OPEN CREDITS — the claimable ₪ of
 * the gaps still awaiting a decision (`awaitingDecision`, G-12a) — plus what
 * was caught today and how many items await a decision. Quiet days (no open
 * credits and nothing caught) are skipped to avoid inbox noise.
 *
 * Detection only: it reads discrepancies and enqueues notifications; delivery
 * happens through outbox-dispatch.
 */
import {
  awaitingDecision,
  enqueueNotification,
  endOfDayReportEmail,
  formatIlsAgorot,
  recipientsForRestaurant,
} from '@restomatch/api';
import { and, count, discrepancies, eq, gte, restaurants, sql } from '@restomatch/db';
import { approvalsGoLink } from './matchInvoice';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl, formatIlsAmount, formatIlDate, startOfIlDay } from '../lib/notifyHelpers';
import { jobDb } from '../db';

export interface EndOfDayReportJob {
  /** When omitted, runs for ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

export function startEndOfDayReportWorker() {
  return makeWorker<EndOfDayReportJob>('end-of-day-report', processEndOfDayReport);
}

/** The end-of-day-report job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processEndOfDayReport(job: WorkerJob<EndOfDayReportJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = jobDb(url);

  const now = job.data.forDate ? new Date(job.data.forDate) : new Date();
  const startToday = startOfIlDay(now);
  const todayKey = startToday.toISOString().slice(0, 10);

  const restaurantRows = job.data.restaurantId
    ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
    : await db.select().from(restaurants);

  let sent = 0;
  let skipped = 0;

  for (const restaurant of restaurantRows) {
    // Open credits = THE "awaiting decision" figure (G-12a): the same rows and
    // ₪ (the letters' claims rule, before VAT) as the queue tiles, home and the
    // nav badge — never a raw Σ|Δ|. Restaurant-wide (scope 'all', owner view).
    const awaiting = await awaitingDecision(
      db,
      { session: { restaurantId: restaurant.id, role: 'owner' } },
      { scope: 'all' },
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

    const openCount = awaiting.toDecide.count;
    const todayCount = Number(todayAgg?.cnt ?? 0);

    // Quiet day → skip (no open credits, nothing caught today).
    if (awaiting.count === 0 && todayCount === 0) {
      skipped += 1;
      continue;
    }

    const recipients = await recipientsForRestaurant(db, restaurant.id);
    if (recipients.length === 0) {
      skipped += 1;
      continue;
    }

    const email = endOfDayReportEmail({
      dateLabel: formatIlDate(startToday).split(',')[0]?.trim() ?? todayKey,
      openCreditsCount: openCount,
      openCreditsIls: formatIlsAgorot(Math.round((awaiting.ils?.excl ?? 0) * 100), { maximumFractionDigits: 0 }),
      todayCaughtCount: todayCount,
      todayCaughtIls: formatIlsAmount(Number(todayAgg?.total ?? 0)),
      pendingApprovals: awaiting.count,
      approvalsUrl: approvalsGoLink(restaurant.id, null, appBaseUrl()),
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
}
