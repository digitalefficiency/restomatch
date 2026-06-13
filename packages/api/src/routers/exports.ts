import { z } from 'zod';
import {
  and,
  eq,
  gte,
  inArray,
  invoices,
  lte,
  matchRuns,
  suppliers,
} from '@restomatch/db';
import { bookkeeperProcedure, requireFeature, router } from '../trpc';

/** Bookkeeping exports require the accounting_export plan feature. */
const exportProcedure = bookkeeperProcedure.use(requireFeature('accounting_export'));
import { toCsv } from '../exports/csv';
import { toUniform1000Lines, type Uniform1000Invoice } from '../exports/uniform-1000';

const PeriodSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
});

export const exportsRouter = router({
  /**
   * CSV — approved/matched invoices in a period.
   * Format: invoice_number, date, supplier, totalExclVat, vat, totalInclVat, status, ocr_confidence.
   */
  invoicesCsv: exportProcedure
    .input(PeriodSchema)
    .query(async ({ ctx, input }) => {
      const rows = await fetchInvoices(ctx.db, ctx.session.restaurantId, input.from, input.to);
      const csv = toCsv(rows, [
        { header: 'מס׳ חשבונית', value: (r) => r.invoiceNumber },
        { header: 'תאריך', value: (r) => r.invoiceDate?.toISOString().slice(0, 10) },
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
      };
    }),

  /**
   * Israeli uniform file (קובץ 1000) — record type C100 only for now.
   * Returns the raw text body; caller wraps in a download response.
   */
  uniform1000: exportProcedure
    .input(PeriodSchema)
    .query(async ({ ctx, input }) => {
      const rows = await fetchInvoices(ctx.db, ctx.session.restaurantId, input.from, input.to);
      const lines: Uniform1000Invoice[] = rows
        .filter((r) => r.invoiceNumber && r.invoiceDate && r.totalInclVat !== null)
        .map((r) => ({
          invoiceNumber: r.invoiceNumber!,
          invoiceDate: (r.invoiceDate as Date).toISOString().slice(0, 10),
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
      };
    }),
});

async function fetchInvoices(
  db: import('@restomatch/db').Database,
  restaurantId: string,
  from: string,
  to: string,
) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setHours(23, 59, 59, 999);
  return db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      supplierName: suppliers.name,
      supplierBusinessId: suppliers.businessId,
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
        inArray(invoices.status, ['matched', 'approved', 'paid']),
        gte(invoices.invoiceDate, fromDate),
        lte(invoices.invoiceDate, toDate),
      ),
    );
}

// Keep matchRuns import stable (referenced via JOIN in later expansions).
void matchRuns;
