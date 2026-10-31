import { z } from 'zod';
import { assertFeatureOn, isFeatureOn } from '../lib/featureGate';
import { recipientsForRestaurant } from '../notifications/recipients';
import { loadMonthlyReport, monthlyReportEmail, monthlyReportWhatsApp, previousMonthKey } from '../reports/monthly';
import { renderMonthlyReportPdf } from '../reports/pdf';
import { managerProcedure, router } from '../trpc';

/**
 * Monthly "one number" report (flag `monthlyReport`): preview this month's (or
 * any past month's — the frozen snapshot once the worker sent it) report in the dashboard — the data, the email exactly as it
 * will be sent, the WhatsApp text — and download the PDF. Owner/manager only
 * (it lists supplier spend), like owner.leakReport. Read-only.
 */
const reportProcedure = managerProcedure.use(async ({ ctx, next }) => {
  await assertFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyReport');
  return next();
});

/** In-app preview of the monthly email (flag `monthlyDigestPreview`) — independent of `monthlyReport`. */
const digestProcedure = managerProcedure.use(async ({ ctx, next }) => {
  await assertFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyDigestPreview');
  return next();
});

/** 'YYYY-MM' of the month containing `now`, in Israel time. */
function currentMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

/** 'YYYY-MM-01' of the month after `month` — the day the monthly email goes out. */
function sendDateFor(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const localeInput = z.enum(['he', 'en']).default('he');

export const monthlyReportRouter = router({
  preview: reportProcedure
    .input(z.object({ month: monthInput.optional(), locale: localeInput }).optional())
    .query(async ({ ctx, input }) => {
      const month = input?.month ?? previousMonthKey(new Date());
      const locale = input?.locale ?? 'he';
      const { data, frozen } = await loadMonthlyReport(ctx.db, ctx.session.restaurantId, month);
      const email = monthlyReportEmail(data, { locale });
      return { data, frozen, email, whatsapp: monthlyReportWhatsApp(data, { locale }) };
    }),

  pdf: reportProcedure
    .input(z.object({ month: monthInput, locale: localeInput }))
    .query(async ({ ctx, input }) => {
      const { data } = await loadMonthlyReport(ctx.db, ctx.session.restaurantId, input.month);
      const bytes = await renderMonthlyReportPdf(data, { locale: input.locale });
      return {
        filename: `restomatch-report-${input.month}-${input.locale}.pdf`,
        base64: Buffer.from(bytes).toString('base64'),
      };
    }),

  /**
   * The monthly email as the owner would receive it — this month so far by
   * default — for an in-app preview. Same numbers as the report and the hero
   * (loadMonthlyReport). Pure read: nothing is queued or sent from here; the
   * real send stays the outbox path behind `monthlyReport`.
   */
  digest: digestProcedure
    .input(z.object({ month: monthInput.optional(), locale: localeInput }).optional())
    .query(async ({ ctx, input }) => {
      const month = input?.month ?? currentMonthKey(new Date());
      const locale = input?.locale ?? 'he';
      const [{ data, frozen }, recipients, fullReport] = await Promise.all([
        loadMonthlyReport(ctx.db, ctx.session.restaurantId, month),
        recipientsForRestaurant(ctx.db, ctx.session.restaurantId, ['owner']),
        isFeatureOn(ctx.db, ctx.session.restaurantId, 'monthlyReport'),
      ]);
      return {
        data,
        frozen,
        subject: monthlyReportEmail(data, { locale }).subject,
        to: recipients.map((r) => r.email),
        sendOn: sendDateFor(month),
        fullReport,
      };
    }),
});
