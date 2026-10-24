import { z } from 'zod';
import {
  and,
  count,
  desc,
  discrepancies,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  lte,
  matchRuns,
  ne,
  restaurants,
  sql,
  suppliers,
} from '@restomatch/db';
import { alias } from 'drizzle-orm/pg-core';
import { bookkeeperProcedure, requireFeature, router } from '../trpc';

/** Bookkeeping exports require the accounting_export plan feature. */
const exportProcedure = bookkeeperProcedure.use(requireFeature('accounting_export'));
import { toCsv } from '../exports/csv';
import { toUniform1000Lines, type Uniform1000Invoice } from '../exports/uniform-1000';
import {
  DEFAULT_EXPORT_TZ,
  EXPORTABLE_INVOICE_STATUSES,
  exportPeriodBounds,
  localIsoDate,
} from '../exports/period';

const PeriodSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
});

export const exportsRouter = router({
  /**
   * CSV — every checked invoice in a period (see EXPORTABLE_INVOICE_STATUSES).
   * Format: invoice_number, date, supplier, totalExclVat, vat, totalInclVat, status, ocr_confidence.
   */
  invoicesCsv: exportProcedure
    .input(PeriodSchema)
    .query(async ({ ctx, input }) => {
      const { rows, tz, undatedCount } = await fetchInvoices(
        ctx.db,
        ctx.session.restaurantId,
        input.from,
        input.to,
      );
      const csv = toCsv(rows, [
        { header: 'מס׳ חשבונית', value: (r) => r.invoiceNumber },
        { header: 'תאריך', value: (r) => (r.invoiceDate ? localIsoDate(r.invoiceDate, tz) : null) },
        { header: 'ספק', value: (r) => r.supplierName },
        { header: 'ח.פ.', value: (r) => r.supplierBusinessId },
        { header: 'סכום ללא מע״מ', value: (r) => r.totalExclVat },
        { header: 'מע״מ', value: (r) => r.vatAmount },
        { header: 'סה״כ עם מע״מ', value: (r) => r.totalInclVat },
        { header: 'סטטוס', value: (r) => r.status },
        { header: 'אמינות OCR', value: (r) => r.ocrConfidence },
      ]);
      return {
        filename: `restomatch-invoices-${input.from}-to-${input.to}.csv`,
        content: csv,
        rowCount: rows.length,
        undatedCount,
      };
    }),

  /**
   * Israeli uniform file (קובץ 1000) — record type C100 only for now.
   * Returns the raw text body; caller wraps in a download response.
   */
  uniform1000: exportProcedure
    .input(PeriodSchema)
    .query(async ({ ctx, input }) => {
      const { rows, tz, undatedCount } = await fetchInvoices(
        ctx.db,
        ctx.session.restaurantId,
        input.from,
        input.to,
      );
      const lines: Uniform1000Invoice[] = rows
        .filter((r) => r.invoiceNumber && r.invoiceDate && r.totalInclVat !== null)
        .map((r) => ({
          invoiceNumber: r.invoiceNumber!,
          invoiceDate: localIsoDate(r.invoiceDate as Date, tz),
          supplierBusinessId: r.supplierBusinessId ?? '',
          supplierName: r.supplierName ?? '',
          totalExclVat: Number(r.totalExclVat ?? 0),
          vatAmount: Number(r.vatAmount ?? 0),
          totalInclVat: Number(r.totalInclVat ?? 0),
        }));

      const content = toUniform1000Lines(lines);
      return {
        filename: `restomatch-1000-${input.from}-to-${input.to}.txt`,
        content,
        rowCount: lines.length,
        undatedCount,
      };
    }),
});

export async function fetchInvoices(
  db: import('@restomatch/db').Database,
  restaurantId: string,
  from: string,
  to: string,
) {
  // Calendar days in the restaurant's timezone, the same month the dashboard hero uses.
  const [restaurant] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const tz = restaurant?.timezone || DEFAULT_EXPORT_TZ;
  const { start: fromDate, end: toDate } = exportPeriodBounds(from, to, tz);
  const notDuplicate = sql`not exists ${unacceptedDuplicate(db, restaurantId)}`;
  const rows = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      supplierName: suppliers.name,
      supplierBusinessId: suppliers.businessId,
      supplierVatRate: suppliers.vatRate,
      totalExclVat: invoices.totalExclVat,
      vatAmount: invoices.vatAmount,
      totalInclVat: invoices.totalInclVat,
      status: invoices.status,
      ocrConfidence: invoices.ocrConfidence,
    })
    .from(invoices)
    .leftJoin(
      suppliers,
      and(eq(suppliers.id, invoices.supplierId), eq(suppliers.restaurantId, restaurantId)),
    )
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...EXPORTABLE_INVOICE_STATUSES]),
        gte(invoices.invoiceDate, fromDate),
        lte(invoices.invoiceDate, toDate),
        notDuplicate,
      ),
    )
    .orderBy(invoices.invoiceDate);

  // Checked invoices with no invoice date (OCR missed it) can't be placed in a
  // period, so no export carries them. Count the ones created in this period so
  // the UI can warn the bookkeeper instead of silently dropping them.
  const [undated] = await db
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        inArray(invoices.status, [...EXPORTABLE_INVOICE_STATUSES]),
        isNull(invoices.invoiceDate),
        gte(invoices.createdAt, fromDate),
        lte(invoices.createdAt, toDate),
        notDuplicate,
      ),
    );
  return { rows, tz, undatedCount: Number(undated?.n ?? 0) };
}

/**
 * Correlated subquery: the invoice's LATEST match run flagged it
 * DUPLICATE_INVOICE and nobody waived that (approvals "Reject" = `rejected` =
 * "not a duplicate, let it go"). Open/escalated means undecided and
 * `accepted`/`resolved` means the duplicate was confirmed and claimed: either
 * way the copy stays `disputed` forever and exporting it would book the same
 * purchase twice. Only the latest run counts, so a re-match that clears the
 * flag (e.g. after fixing a misread invoice number) brings the invoice back.
 */
function unacceptedDuplicate(db: import('@restomatch/db').Database, restaurantId: string) {
  const latestRun = alias(matchRuns, 'latest_run');
  const latestRunId = db
    .select({ id: latestRun.id })
    .from(latestRun)
    .where(and(eq(latestRun.invoiceId, invoices.id), eq(latestRun.restaurantId, restaurantId)))
    .orderBy(desc(latestRun.runAt))
    .limit(1);
  return db
    .select({ one: sql`1` })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.matchRunId, sql`${latestRunId}`),
        eq(discrepancies.restaurantId, restaurantId),
        eq(discrepancies.type, 'DUPLICATE_INVOICE'),
        ne(discrepancies.resolutionStatus, 'rejected'),
      ),
    );
}
