/**
 * end-of-day-report — 19:00 IL digest emailed to each restaurant's managers.
 *
 * Summarizes the day's money picture, led by OPEN CREDITS — the claimable ₪ of
 * the gaps still awaiting a decision (`awaitingDecision`, G-12a) — plus what
 * was caught today (endOfDayFigures) and how many items await a decision. Quiet days (no open
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
import { LEAK_FILTER } from '@restomatch/charts';
import { eq, restaurants, sql, type Database } from '@restomatch/db';
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
    // Open credits = THE "awaiting decision" figure (G-12a): the same rows and
    // ₪ (the letters' claims rule, before VAT) as the queue tiles, home and the
    // nav badge — never a raw Σ|Δ|. Restaurant-wide (scope 'all', owner view).
    const awaiting = await awaitingDecision(
      db,
      { session: { restaurantId: restaurant.id, role: 'owner' } },
      { scope: 'all' },
    );
    // Caught today: the hero's LEAK_FILTER, capped per invoice (money review G).
    const { todayCount, todayIls } = await endOfDayFigures(db, restaurant.id, startToday);
    const openCount = awaiting.toDecide.count;

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
      todayCaughtIls: formatIlsAmount(todayIls),
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
