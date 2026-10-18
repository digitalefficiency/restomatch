import { z } from 'zod';
import { assertFeatureOn } from '../lib/featureGate';
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
});
