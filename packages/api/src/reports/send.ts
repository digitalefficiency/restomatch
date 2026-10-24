import { asc, eq, memberships, monthlyReports, restaurants, type Database } from '@restomatch/db';
import { isFeatureOn } from '../lib/featureGate';
import { enqueueNotification } from '../notifications/outbox';
import { recipientsForRestaurant } from '../notifications/recipients';
import type { Notifier } from '../notifications/types';
import { MockWhatsAppNotifier } from '../notifications/whatsapp';
import {
  ensureMonthlyReport,
  monthlyReportEmail,
  monthlyReportWhatsApp,
  previousMonthKey,
} from './monthly';

/**
 * The 1st-of-the-month job body: for every restaurant with `monthlyReport` on,
 * freeze last month's report and send it — an email per owner/manager (in the
 * member's language) through the outbox, and one WhatsApp-length text through
 * the WhatsApp notifier abstraction.
 *
 * WhatsApp uses the STUB provider (MockWhatsAppNotifier: outbox row marked sent,
 * nothing leaves the building) unless a caller injects another notifier. A real
 * send needs an owner phone number and a Meta-approved template — owner action.
 *
 * A restaurant that throws is logged and listed in `failed`; the others still run.
 *
 * Idempotent: a month whose report row already has `sent_at` is skipped, and
 * every outbox row carries a dedupe key (restaurant, month, recipient).
 */
export async function sendMonthlyReports(
  db: Database,
  opts: { now?: Date; restaurantId?: string; appUrl?: string; whatsapp?: Notifier } = {},
): Promise<{ restaurants: number; emails: number; whatsapp: number; skipped: number; failed: string[] }> {
  const now = opts.now ?? new Date();
  const whatsapp = opts.whatsapp ?? new MockWhatsAppNotifier();
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
      if (report.sentAt) {
        skipped += 1;
        continue;
      }
      const reportUrl = opts.appUrl ? `${opts.appUrl}/dashboard/reports/monthly?month=${month}` : undefined;
      const recipients = await recipientsForRestaurant(db, r.id);
      const locales = new Map(
        (
          await db
            .select({ userId: memberships.userId, locale: memberships.preferredLocale })
            .from(memberships)
            .where(eq(memberships.restaurantId, r.id))
        ).map((m) => [m.userId, m.locale]),
      );
      for (const to of recipients) {
        const locale = locales.get(to.userId) === 'en' ? 'en' : 'he';
        const email = monthlyReportEmail(report.data, { locale, reportUrl });
        const { deduped } = await enqueueNotification(db, {
          restaurantId: r.id,
          channel: 'email',
          target: to.email,
          subject: email.subject,
          body: email.text,
          html: email.html,
          relatedEntityType: 'monthly_report',
          relatedEntityId: report.id,
          dedupeKey: `monthly-report:${r.id}:${month}:${to.email}`,
        });
        if (!deduped) emails += 1;
      }
      const sent = await whatsapp.send(db, {
        restaurantId: r.id,
        channel: 'whatsapp',
        target: 'role:owner',
        body: monthlyReportWhatsApp(report.data, { locale: 'he', reportUrl }),
        relatedEntityType: 'monthly_report',
        relatedEntityId: report.id,
        dedupeKey: `monthly-report:${r.id}:${month}:whatsapp`,
      });
      if (sent.ok) wa += 1;
      await db.update(monthlyReports).set({ sentAt: now }).where(eq(monthlyReports.id, report.id));
    } catch (err) {
      failed.push(r.id);
      console.error(`[monthly-report] restaurant=${r.id} failed`, err);
    }
  }
  return { restaurants: processed, emails, whatsapp: wa, skipped, failed };
}
