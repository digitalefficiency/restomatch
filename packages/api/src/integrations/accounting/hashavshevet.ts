import { agorotToPlain, cell, CRLF, ddmmyyyy, supplierAccount } from './common';
import { encodeWindows1255 } from './encoding';
import type { AccountingConfig, AccountingFile, AccountingInvoice } from './types';

/**
 * Hashavshevet (חשבשבת) journal-movement import — "קליטת תנועות" from a
 * delimited text file. Hashavshevet reads any column order through an import
 * definition (קובץ הגדרות .prm) the accountant creates once; HASHAVSHEVET_COLUMNS
 * is that order (docs/client-ready/reports/wave1-integrations.md lists the
 * field-by-field definition).
 *
 * One movement per invoice, balanced: Dr purchases (excl. VAT) + Dr input VAT
 * = Cr supplier card (incl. VAT). Tab-separated, CRLF, Windows-1255, no header
 * row (Hashavshevet would import a header as a movement).
 */
export const HASHAVSHEVET_COLUMNS = [
  'סוג תנועה',
  'אסמכתא',
  'אסמכתא 2',
  'תאריך אסמכתא',
  'תאריך ערך',
  'פרטים',
  'חשבון חובה 1',
  'חשבון חובה 2',
  'חשבון זכות 1',
  'סכום חובה 1',
  'סכום חובה 2',
  'סכום זכות 1',
] as const;

/** אסמכתא is numeric (up to 9 digits) in Hashavshevet; the full number goes in אסמכתא 2. */
function numericRef(invoiceNumber: string): string {
  return invoiceNumber.replace(/\D/g, '').slice(-9);
}

export function hashavshevetLines(invoices: AccountingInvoice[], cfg: AccountingConfig): string[] {
  return invoices.map((inv) =>
    [
      cell(cfg.movementType, 3),
      numericRef(inv.invoiceNumber),
      cell(inv.invoiceNumber, 20),
      ddmmyyyy(inv.invoiceDate),
      ddmmyyyy(inv.invoiceDate),
      cell(inv.supplierName, 50),
      cell(cfg.expenseAccount, 15),
      cell(cfg.vatInputAccount, 15),
      cell(supplierAccount(inv, cfg), 15),
      agorotToPlain(inv.totalExclAgorot),
      agorotToPlain(inv.vatAgorot),
      agorotToPlain(inv.totalInclAgorot),
    ].join('\t'),
  );
}

export function hashavshevetFile(
  invoices: AccountingInvoice[],
  cfg: AccountingConfig,
  period: { from: string; to: string },
): AccountingFile {
  const lines = hashavshevetLines(invoices, cfg);
  return {
    filename: `restomatch-hashavshevet-${period.from}-to-${period.to}.txt`,
    mimeType: 'text/plain; charset=windows-1255',
    encoding: 'windows-1255',
    bytes: encodeWindows1255(lines.length ? lines.join(CRLF) + CRLF : ''),
    rowCount: lines.length,
  };
}
