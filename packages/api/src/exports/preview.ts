import { and, eq, gte, inArray, invoices, isNull, lte, not, or, sql, type Database } from '@restomatch/db';
import { fetchInvoices, unacceptedDuplicate } from '../routers/exports';
import { EXPORTABLE_INVOICE_STATUSES, exportPeriodBounds } from './period';

/**
 * W3-05b · `exports.preview`: what an accounting export of [from, to] will hold,
 * and every invoice of the period it will NOT hold, by reason, BEFORE the
 * download. The included set is exactly `fetchInvoices` (the CSV / 1000 file's
 * own query), so the preview can never disagree with the file.
 *
 * Money is integer agorot, summed from the NUMERIC(12,2) strings (no float math).
 * Read-only; every query is scoped by `restaurant_id`.
 */

/** Why an invoice of the period is not in the file (or not in the 1000 file). */
export type ExcludedReason =
  /** Not checked yet (in OCR, or parsed and not matched): the numbers may still change. */
  | 'notChecked'
  /** Flagged as a duplicate copy and not waived: exporting it would book the purchase twice. */
  | 'duplicate'
  /** Checked but no invoice date (OCR missed it): it can't be placed in a period. */
  | 'undated'
  /** In the CSV, but the 1000 file needs an invoice number and a total. */
  | 'notInUniform';

export const EXCLUDED_REASONS: readonly ExcludedReason[] = ['notChecked', 'duplicate', 'undated', 'notInUniform'];

/** At most this many ids per reason (for fix links); `count` is always the full number. */
export const PREVIEW_ID_LIMIT = 20;

export interface ExcludedGroup {
  reason: ExcludedReason;
  count: number;
  /** Σ total incl. VAT of the group, integer agorot (a missing total counts 0). */
  totalInclVatAgorot: number;
  invoiceIds: string[];
}

export interface ExportPreview {
  from: string;
  to: string;
  /** Invoices in the file (= `invoicesCsv` rows). */
  invoiceCount: number;
  totalInclVatAgorot: number;
  vatAgorot: number;
  /** In the file with an open gap (`disputed`): the file's status column flags them. */
  disputedCount: number;
  /** Groups with count > 0 only, in EXCLUDED_REASONS order. */
  excluded: ExcludedGroup[];
  /** In the file, but the supplier has no ח״פ (the 1000 file's field stays empty). */
  missingBusinessId: { count: number; supplierIds: string[] };
}

/** 2-dp NUMERIC string → integer agorot, exact. */
export function toAgorot(v: string | null | undefined): number {
  if (v == null || v === '') return 0;
  const neg = v.startsWith('-');
  const [int = '0', frac = ''] = v.replace('-', '').split('.');
  const ag = Number(int || '0') * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -ag : ag;
}

const group = (reason: ExcludedReason, rows: ReadonlyArray<{ id: string; totalInclVat: string | null }>): ExcludedGroup => ({
  reason,
  count: rows.length,
  totalInclVatAgorot: rows.reduce((t, r) => t + toAgorot(r.totalInclVat), 0),
  invoiceIds: rows.slice(0, PREVIEW_ID_LIMIT).map((r) => r.id),
});

export async function computeExportPreview(db: Database, restaurantId: string, from: string, to: string): Promise<ExportPreview> {
  const { rows, tz } = await fetchInvoices(db, restaurantId, from, to);
  const { start, end } = exportPeriodBounds(from, to, tz);
  const exportable = [...EXPORTABLE_INVOICE_STATUSES];
  const dup = sql`exists ${unacceptedDuplicate(db, restaurantId)}`;
  const notDup = sql`not exists ${unacceptedDuplicate(db, restaurantId)}`;
  const pick = { id: invoices.id, totalInclVat: invoices.totalInclVat };
  const inPeriod = and(
    sql`COALESCE(${invoices.invoiceDate}, ${invoices.createdAt}) >= ${start.toISOString()}::timestamptz`,
    sql`COALESCE(${invoices.invoiceDate}, ${invoices.createdAt}) <= ${end.toISOString()}::timestamptz`,
  );

  const [notChecked, duplicate, undated] = await Promise.all([
    db
      .select(pick)
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), not(inArray(invoices.status, exportable)), inPeriod))
      .orderBy(invoices.createdAt, invoices.id),
    db
      .select(pick)
      .from(invoices)
      .where(
        and(
          eq(invoices.restaurantId, restaurantId),
          inArray(invoices.status, exportable),
          or(
            and(gte(invoices.invoiceDate, start), lte(invoices.invoiceDate, end)),
            and(isNull(invoices.invoiceDate), gte(invoices.createdAt, start), lte(invoices.createdAt, end)),
          ),
          dup,
        ),
      )
      .orderBy(invoices.createdAt, invoices.id),
    // The same rule as fetchInvoices' undatedCount (checked, no date, created in the period, not a duplicate).
    db
      .select(pick)
      .from(invoices)
      .where(
        and(
          eq(invoices.restaurantId, restaurantId),
          inArray(invoices.status, exportable),
          isNull(invoices.invoiceDate),
          gte(invoices.createdAt, start),
          lte(invoices.createdAt, end),
          notDup,
        ),
      )
      .orderBy(invoices.createdAt, invoices.id),
  ]);
  // The 1000 file's own filter (routers/exports.ts uniform1000): number + total required.
  const notInUniform = rows.filter((r) => !r.invoiceNumber || r.totalInclVat === null);
  const noBizId = rows.filter((r) => !r.supplierBusinessId);
  const supplierIds = [...new Set(noBizId.map((r) => r.supplierId).filter((s): s is string => !!s))];

  return {
    from,
    to,
    invoiceCount: rows.length,
    totalInclVatAgorot: rows.reduce((t, r) => t + toAgorot(r.totalInclVat), 0),
    vatAgorot: rows.reduce((t, r) => t + toAgorot(r.vatAmount), 0),
    disputedCount: rows.filter((r) => r.status === 'disputed').length,
    excluded: [
      group('notChecked', notChecked),
      group('duplicate', duplicate),
      group('undated', undated),
      group('notInUniform', notInUniform),
    ].filter((g) => g.count > 0),
    missingBusinessId: { count: noBizId.length, supplierIds: supplierIds.slice(0, PREVIEW_ID_LIMIT) },
  };
}
