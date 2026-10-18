import { toCsv } from '../../exports/csv';
import { agorotToPlain, cell, CRLF, ddmmyyyy, supplierAccount } from './common';
import { encodeUtf8Bom } from './encoding';
import type { AccountingConfig, AccountingFile, AccountingInvoice } from './types';

/**
 * Rivhit (ריווחית) expense-document import from a spreadsheet. Rivhit's import
 * screen maps spreadsheet columns to fields by header, so the header row uses
 * the field names the accountant sees on screen. UTF-8 CSV with a BOM (Excel
 * and Rivhit open the Hebrew correctly), CRLF, DD/MM/YYYY.
 */
export const RIVHIT_HEADERS = [
  'תאריך מסמך',
  'מספר מסמך',
  'שם ספק',
  'מספר עוסק',
  'כרטיס ספק',
  'סכום לפני מע״מ',
  'מע״מ',
  'סכום כולל מע״מ',
  'כרטיס הוצאה',
] as const;

export function rivhitCsv(invoices: AccountingInvoice[], cfg: AccountingConfig): string {
  const [date, num, name, biz, card, excl, vat, incl, expense] = RIVHIT_HEADERS;
  return toCsv(invoices, [
    { header: date, value: (r) => ddmmyyyy(r.invoiceDate) },
    { header: num, value: (r) => cell(r.invoiceNumber) },
    { header: name, value: (r) => cell(r.supplierName) },
    { header: biz, value: (r) => r.supplierBusinessId.replace(/\D/g, '') },
    { header: card, value: (r) => supplierAccount(r, cfg) },
    { header: excl, value: (r) => agorotToPlain(r.totalExclAgorot) },
    { header: vat, value: (r) => agorotToPlain(r.vatAgorot) },
    { header: incl, value: (r) => agorotToPlain(r.totalInclAgorot) },
    { header: expense, value: () => cfg.expenseAccount },
  ])
    .split('\n')
    .join(CRLF);
}

export function rivhitFile(
  invoices: AccountingInvoice[],
  cfg: AccountingConfig,
  period: { from: string; to: string },
): AccountingFile {
  return {
    filename: `restomatch-rivhit-${period.from}-to-${period.to}.csv`,
    mimeType: 'text/csv; charset=utf-8',
    encoding: 'utf-8',
    bytes: encodeUtf8Bom(rivhitCsv(invoices, cfg) + CRLF),
    rowCount: invoices.length,
  };
}
