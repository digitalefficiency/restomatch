import { agorotToPlain, CRLF, ddmmyyyy, safeCell, supplierAccount } from './common';
import { encodeUtf16leBom } from './encoding';
import type { AccountingConfig, AccountingFile, AccountingInvoice } from './types';

/**
 * Priority (פריוריטי) supplier-invoice load — a "ממשק טעינה" (form-load
 * interface) that reads a tab-delimited Unicode text file into the supplier
 * financial invoices form. Records are typed by their first column:
 *
 *   1  header  SUPNAME · BOOKNUM · IVDATE · DETAILS · TOTPRICE (incl. VAT, for checking)
 *   2  line    ACCNAME · DETAILS · QPRICE (excl. VAT) · VAT
 *
 * Every `1` record is followed by its `2` record(s); the interface definition
 * maps each record type to the form / sub-form columns
 * (docs/client-ready/reports/wave1-integrations.md). Dates DD/MM/YY.
 */
export const PRIORITY_RECORDS = {
  header: ['1', 'SUPNAME', 'BOOKNUM', 'IVDATE', 'DETAILS', 'TOTPRICE'],
  line: ['2', 'ACCNAME', 'DETAILS', 'QPRICE', 'VAT'],
} as const;

export function priorityLines(invoices: AccountingInvoice[], cfg: AccountingConfig): string[] {
  const out: string[] = [];
  for (const inv of invoices) {
    out.push(
      [
        '1',
        safeCell(supplierAccount(inv, cfg), 16),
        safeCell(inv.invoiceNumber, 20),
        ddmmyyyy(inv.invoiceDate, true),
        safeCell(inv.supplierName, 48),
        agorotToPlain(inv.totalInclAgorot),
      ].join('\t'),
    );
    out.push(
      [
        '2',
        safeCell(cfg.expenseAccount, 15),
        safeCell(`RestoMatch ${inv.invoiceNumber}`, 48),
        agorotToPlain(inv.totalExclAgorot),
        agorotToPlain(inv.vatAgorot),
      ].join('\t'),
    );
  }
  return out;
}

export function priorityFile(
  invoices: AccountingInvoice[],
  cfg: AccountingConfig,
  period: { from: string; to: string },
): AccountingFile {
  const lines = priorityLines(invoices, cfg);
  return {
    filename: `restomatch-priority-${period.from}-to-${period.to}.txt`,
    mimeType: 'text/plain; charset=utf-16le',
    encoding: 'utf-16le',
    bytes: encodeUtf16leBom(lines.length ? lines.join(CRLF) + CRLF : ''),
    rowCount: invoices.length,
    replacedChars: 0,
  };
}
