/**
 * end-of-day-report — 19:00 IL digest emailed to each restaurant's managers.
 *
 * Summarizes the day's money picture, led by OPEN CREDITS — the claimable ₪ of
 * the gaps still awaiting a decision (`awaitingDecision`, G-12a) — plus what
 * was caught today (endOfDayFigures) and how many items await a decision. Quiet days (no
 * claimable ₪ open and nothing caught today) are skipped to avoid inbox noise: review-only and
 * pending-link-only days are quiet (their rows carry no ₪ yet), so a digest never says "0 ₪".
 *
 * Detection only: it reads discrepancies and enqueues notifications; delivery
 * happens through outbox-dispatch.
 */
import {
  awaitingDecisionDetail,
  briefOptionOn,
  enqueueNotification,
  endOfDayReportEmail,
  formatIlsAgorot,
  recipientsForRestaurant,
} from '@restomatch/api';
import { LEAK_FILTER } from '@restomatch/charts';
import { and, eq, notificationsOutbox, restaurants, sql, type Database } from '@restomatch/db';
import { approvalsGoLink } from './matchInvoice';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl, formatIlDate, ilDateKey, startOfIlDay } from '../lib/notifyHelpers';
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
  /** End of the report day (exclusive). Bounds "caught today" for a catch-up run after midnight. */
  endOfDay?: Date,
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
  const today = await agg(
    endOfDay
      ? sql`d.created_at >= ${startToday.toISOString()}::timestamptz AND d.created_at < ${endOfDay.toISOString()}::timestamptz`
      : sql`d.created_at >= ${startToday.toISOString()}::timestamptz`,
  );
  return { openCount: open.cnt, openIls: open.total, todayCount: today.cnt, todayIls: today.total };
}

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

/**
 * A digest ₪ figure: whole shekels, but agorot under ₪1 — a ₪0.40 gap never reads "0 ₪".
 */
export function digestIls(agorot: number): string {
  return formatIlsAgorot(agorot, { maximumFractionDigits: agorot < 100 ? 2 : 0 });
}

/**
 * The open-credits ₪ of the digest, per VAT basis (never summed): before VAT,
 * a duplicate invoice's incl.-VAT claim, a VAT amount. Null when all are zero (never "₪0").
 */
export function openCreditsFigure(ils: { excl: number; incl: number; vat: number } | null): string | null {
  const ag = (v: number | undefined) => Math.round((v ?? 0) * 100);
  const f = digestIls;
  const parts: string[] = [];
  if (ag(ils?.excl) > 0) parts.push(f(ag(ils?.excl)));
  if (ag(ils?.incl) > 0) parts.push(`${f(ag(ils?.incl))} כולל מע״מ (חשבוניות כפולות)`);
  if (ag(ils?.vat) > 0) parts.push(`${f(ag(ils?.vat))} מע״מ (הפרשי מע״מ)`);
  return parts.length ? parts.join(' + ') : null;
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
    // AU-04 A7: the owner's off switch (AU-01 option, default on).
    if (!briefOptionOn(restaurant.settings, 'eveningDigest')) {
      console.log(`[end-of-day-report] restaurant=${restaurant.id} skipped: option off`);
      skipped += 1;
      continue;
    }
    // Open credits = THE "awaiting decision" figure (G-12a): the same rows and
    // ₪ (the letters' claims rule, before VAT) as the queue tiles, home and the
    // nav badge — never a raw Σ|Δ|. Restaurant-wide (scope 'all', owner view).
    const { summary: awaiting, claims } = await awaitingDecisionDetail(
      db,
      { session: { restaurantId: restaurant.id, role: 'owner' } },
      { scope: 'all' },
    );
    // Caught today: the hero's LEAK_FILTER, capped per invoice (money review G).
    const { todayCount, todayIls } = await endOfDayFigures(db, restaurant.id, startToday, endOfDay);
    // Credits are claimable ₪; rows on invoices still waiting for an order link
    // have no ₪ yet (R4-2): they are the pending-link line, never a credit.
    const openFigure = openCreditsFigure(awaiting.ils);
    // '(N)' beside the ₪ = the rows that carry it: awaitingDecision's claimable
    // lines, the same rows its ₪ is summed from (Train C r6, M-2).
    const openCount = openFigure != null ? claims.filter((c) => Math.round(c.amountIls * 100) > 0).length : 0;
    // "Caught today" is a ₪ row: no ₪, no row (never '0 ₪ (0)').
    const caughtAgorot = Math.round(todayIls * 100);
    const caughtCount = caughtAgorot > 0 ? todayCount : 0;

    // Quiet day → skip: no claimable ₪ open and nothing caught today. Review-only
    // (Train C B2) and pending-link-only days are quiet: no ₪ to name yet.
    if (openFigure == null && caughtCount === 0) {
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
      // Each VAT basis as its own labelled figure, never summed (warden MEDIUM-1, Train C B2).
      openCreditsIls: openFigure,
      pendingLinkCount: awaiting.pendingLink.count,
      todayCaughtCount: caughtCount,
      todayCaughtIls: digestIls(caughtAgorot),
      pendingApprovals: awaiting.count,
      approvalsUrl: approvalsGoLink(restaurant.id, null, appBaseUrl()),
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
