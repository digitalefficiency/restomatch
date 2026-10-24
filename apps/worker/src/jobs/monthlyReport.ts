/**
 * monthly-report — 1st of the month, 07:45 IL (flag `monthlyReport`): freeze
 * last month's "one number" report and send it (email via the outbox, WhatsApp
 * through the stub notifier). Idempotent per restaurant-month (sendMonthlyReports).
 */
import { sendMonthlyReports } from '@restomatch/api';
import { jobDb } from '../db';
import { makeWorker } from '../queue';
import { appBaseUrl } from '../lib/notifyHelpers';

export interface MonthlyReportJob {
  restaurantId?: string;
  /** Override "now" (tests / manual re-run for a given 1st). */
  forDate?: string;
}

export function startMonthlyReportWorker() {
  return makeWorker<MonthlyReportJob>('monthly-report', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const res = await sendMonthlyReports(jobDb(url), {
      restaurantId: job.data.restaurantId,
      now: job.data.forDate ? new Date(job.data.forDate) : new Date(),
      appUrl: appBaseUrl(),
    });
    console.log(
      `[monthly-report] restaurants=${res.restaurants} emails=${res.emails} whatsapp=${res.whatsapp} skipped=${res.skipped} failed=${res.failed.length}${res.failed.length ? ` (${res.failed.join(',')})` : ''}`,
    );
    return res;
  });
}
