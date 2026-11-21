import { and, asc, eq, monthlyReports, notificationsOutbox, restaurants, sql, type Database } from '@restomatch/db';
import { isFeatureOn } from '../lib/featureGate';
import { notify, type RenderFn } from '../notifications/notify';
import { MANAGER_ROLES } from '../notifications/recipients';
import type { Notifier } from '../notifications/types';
import {
  ensureMonthlyReport,
  monthlyReportEmail,
  monthlyReportWhatsApp,
  previousMonthKey,
} from './monthly';

export const MONTHLY_REPORT_EVENT = 'monthly_report.ready';

/**
 * `monthly_reports.sent_at` is a FACT, not an intention: the earliest
 * `sent_at` of this report's outbox rows that the dispatcher actually marked
 * `sent`. Null while nothing has left the building.
 */
export async function reconcileMonthlyReportSentAt(db: Database, reportId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`min(${notificationsOutbox.sentAt})` })
    .from(notificationsOutbox)
    .where(
      and(
        eq(notificationsOutbox.relatedEntityType, 'monthly_report'),
        eq(notificationsOutbox.relatedEntityId, reportId),
        eq(notificationsOutbox.status, 'sent'),
      ),
    );
  const at = row?.at ? new Date(row.at) : null;
  if (at) await db.update(monthlyReports).set({ sentAt: at }).where(eq(monthlyReports.id, reportId));
  return at;
}

/**
 * The 1st-of-the-month job body: for every restaurant with `monthlyReport` on,
 * freeze last month's report and hand it to `notify()` for the owner/manager
 * members — an e-mail each (in the member's language) and a WhatsApp-length
 * text for members with a VERIFIED phone (none until G-03 + W2-14's OTP).
 *
 * Honest delivery (G-06): nothing here says "sent". Rows stay `queued` until
 * the dispatcher sends them (or parks them `failed + skipped_no_provider`).
 * `monthly_reports.sent_at` is set only by the reconcile step at the start of
 * each run, from the rows the dispatcher really marked `sent`.
 *
 * Idempotent through the per-(user, channel) dedupe keys: a run that enqueues
 * nothing new counts the restaurant as `skipped`. A restaurant that throws is
 * logged and listed in `failed`; the others still run.
 *
 * `whatsapp` is accepted for call-site compatibility and ignored: no in-process
 * notifier may send from here (the global stub removal is H-05's).
 */
export async function sendMonthlyReports(
  db: Database,
  opts: { now?: Date; restaurantId?: string; appUrl?: string; whatsapp?: Notifier } = {},
): Promise<{ restaurants: number; emails: number; whatsapp: number; skipped: number; failed: string[] }> {
  const now = opts.now ?? new Date();
  const rows = opts.restaurantId
    ? await db
        .select({ id: restaurants.id, tz: restaurants.timezone })
        .from(restaurants)
        .where(eq(restaurants.id, opts.restaurantId))
    : await db
        .select({ id: restaurants.id, tz: restaurants.timezone })
        .from(restaurants)
        .orderBy(asc(restaurants.createdAt), asc(restaurants.id));

  let processed = 0;
  let emails = 0;
  let wa = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const r of rows) {
    // One bad tenant (e.g. an invalid timezone → RangeError) must not stop the run
    // for every restaurant after it: log, record, continue.
    try {
      if (!(await isFeatureOn(db, r.id, 'monthlyReport'))) continue;
      processed += 1;
      const month = previousMonthKey(now, r.tz ?? 'Asia/Jerusalem');
      const report = await ensureMonthlyReport(db, r.id, month, { now });
      if (report.sentAt || (await reconcileMonthlyReportSentAt(db, report.id))) {
        skipped += 1;
        continue;
      }
      const reportUrl = opts.appUrl ? `${opts.appUrl}/dashboard/reports/monthly?month=${month}` : undefined;
      const render: RenderFn = ({ channel, locale }) => {
        if (channel === 'email') {
          const email = monthlyReportEmail(report.data, { locale, reportUrl });
          return { subject: email.subject, body: email.text, html: email.html };
        }
        if (channel === 'whatsapp') return { body: monthlyReportWhatsApp(report.data, { locale, reportUrl }) };
        return null;
      };
      const res = await db.transaction(async (tx) =>
        notify(tx as unknown as Database, {
          restaurantId: r.id,
          event: MONTHLY_REPORT_EVENT,
          audience: { roles: MANAGER_ROLES },
          template: 'monthlyReport',
          entity: { type: 'monthly_report', id: report.id },
          channels: ['email', 'whatsapp'],
          deepLink: `/dashboard/reports/monthly?month=${month}`,
          render,
          now,
          timezone: r.tz ?? undefined,
        }),
      );
      const fresh = res.rows.filter((x) => x.id && !x.deduped);
      emails += fresh.filter((x) => x.channel === 'email').length;
      wa += fresh.filter((x) => x.channel === 'whatsapp').length;
      if (fresh.length === 0) skipped += 1;
    } catch (err) {
      failed.push(r.id);
      console.error(`[monthly-report] restaurant=${r.id} failed`, err);
    }
  }
  return { restaurants: processed, emails, whatsapp: wa, skipped, failed };
}
