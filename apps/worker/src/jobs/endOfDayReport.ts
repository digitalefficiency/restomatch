/**
 * end-of-day-report — 19:00 IL digest emailed to each restaurant's managers.
 *
 * Summarizes the day's money picture, led by OPEN CREDITS — claimable findings
 * still `open`/`escalated` (endOfDayFigures) — plus what was caught today and how many items await a decision. Quiet days (no open
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
import { LEAK_FILTER } from '@restomatch/charts';
import { and, count, discrepancies, eq, restaurants, sql, type Database } from '@restomatch/db';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl, formatIlsAmount, formatIlDate, startOfIlDay } from '../lib/notifyHelpers';
import { jobDb } from '../db';

export interface EndOfDayReportJob {
  /** When omitted, runs for ALL restaurants. */
  restaurantId?: string;
  /** Optional override for "today" (tests). */
  forDate?: string;
}

/**
 * The digest's ₪ (money review G), per invoice then summed, each invoice capped at
 * its total incl. VAT like the hero:
 *  • open credits — the claimable rule on findings still open/escalated: warn/block,
 *    a leak type (LEAK_FILTER; every never-claimable type is outside it, so a
 *    MISSING_ON_INVOICE or an under-charge is never "money to get back"), |Δ| > 0;
 *  • caught today — the hero's LEAK_FILTER on today's findings, same cap.
 * An info line never counts.
 */
export async function endOfDayFigures(
  db: Database,
  restaurantId: string,
  startToday: Date,
): Promise<{ openCount: number; openIls: number; todayCount: number; todayIls: number }> {
  const agg = async (where: ReturnType<typeof sql>) => {
    const res = await db.execute(sql`
      SELECT COALESCE(SUM(x.n), 0)::int AS cnt, COALESCE(SUM(x.capped), 0) AS total
      FROM (
        SELECT COUNT(*) AS n,
               LEAST(SUM(ABS(d.delta_amount)), GREATEST(COALESCE(i.total_incl_vat, SUM(ABS(d.delta_amount))), 0)) AS capped
        FROM discrepancies d
        JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
        LEFT JOIN invoices i ON i.id = mr.invoice_id AND i.restaurant_id = ${restaurantId}
        WHERE d.restaurant_id = ${restaurantId}
          AND ${LEAK_FILTER}
          AND ABS(d.delta_amount) > 0
          AND ${where}
        GROUP BY mr.invoice_id, i.total_incl_vat
      ) x
    `);
    const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
    return { cnt: Number(rows[0]?.cnt ?? 0), total: Math.round(Number(rows[0]?.total ?? 0) * 100) / 100 };
  };
  const open = await agg(sql`d.resolution_status IN ('open', 'escalated')`);
  const today = await agg(sql`d.created_at >= ${startToday.toISOString()}::timestamptz`);
  return { openCount: open.cnt, openIls: open.total, todayCount: today.cnt, todayIls: today.total };
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
    const { openCount, openIls, todayCount, todayIls } = await endOfDayFigures(db, restaurant.id, startToday);

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
      openCreditsIls: formatIlsAmount(openIls),
      todayCaughtCount: todayCount,
      todayCaughtIls: formatIlsAmount(todayIls),
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
}
