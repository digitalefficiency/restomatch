import { hashavshevetFile } from './hashavshevet';
import { priorityFile } from './priority';
import { rivhitFile } from './rivhit';
import type { AccountingConfig, AccountingFile, AccountingFormat, AccountingInvoice } from './types';

export * from './types';
export { numericToAgorot, agorotToPlain } from './common';
export { encodeWindows1255 } from './encoding';
export { HASHAVSHEVET_COLUMNS } from './hashavshevet';
export { PRIORITY_RECORDS } from './priority';
export { RIVHIT_HEADERS } from './rivhit';

const RENDERERS: Record<
  AccountingFormat,
  (inv: AccountingInvoice[], cfg: AccountingConfig, period: { from: string; to: string }) => AccountingFile
> = {
  hashavshevet: hashavshevetFile,
  priority: priorityFile,
  rivhit: rivhitFile,
};

export function renderAccountingFile(
  format: AccountingFormat,
  invoices: AccountingInvoice[],
  cfg: AccountingConfig,
  period: { from: string; to: string },
): AccountingFile {
  return RENDERERS[format](invoices, cfg, period);
}
