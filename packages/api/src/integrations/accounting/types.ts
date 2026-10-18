/**
 * Accounting-package export (wave-1 `integrations`). One purchase invoice as
 * the accounting file formats need it: money in integer agorot, the date
 * already a calendar day in the restaurant's timezone.
 */
export interface AccountingInvoice {
  invoiceNumber: string;
  /** `YYYY-MM-DD`, restaurant-local. */
  invoiceDate: string;
  supplierId: string | null;
  supplierName: string;
  supplierBusinessId: string;
  totalExclAgorot: number;
  vatAgorot: number;
  totalInclAgorot: number;
}

/**
 * Chart-of-accounts codes the bookkeeper sets once (restaurants.settings
 * .integrations.accounting). Supplier cards default to the supplier's company
 * id (ח.פ.), the usual key of a supplier card; a per-supplier override wins.
 */
export interface AccountingConfig {
  /** Purchases / cost-of-goods account (חשבון הוצאה/קניות). */
  expenseAccount: string;
  /** Input-VAT account (מע״מ תשומות). */
  vatInputAccount: string;
  /** Hashavshevet movement type code (סוג תנועה) defined for supplier invoices. */
  movementType: string;
  /** supplierId → supplier card / vendor code in the accounting package. */
  supplierAccounts: Record<string, string>;
}

export const DEFAULT_ACCOUNTING_CONFIG: AccountingConfig = {
  expenseAccount: '6000',
  vatInputAccount: '3700',
  movementType: 'חס',
  supplierAccounts: {},
};

export const ACCOUNTING_FORMATS = ['hashavshevet', 'priority', 'rivhit'] as const;
export type AccountingFormat = (typeof ACCOUNTING_FORMATS)[number];

export interface AccountingFile {
  filename: string;
  mimeType: string;
  /** Human-readable encoding name, shown next to the download. */
  encoding: 'windows-1255' | 'utf-16le' | 'utf-8';
  bytes: Uint8Array;
  /** Invoices written (rows without a number/date/total are skipped). */
  rowCount: number;
}
