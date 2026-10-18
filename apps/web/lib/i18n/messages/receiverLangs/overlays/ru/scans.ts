import type { Shape } from '../../../../translate';
import type { he } from '../../../scans/he';

/** scans — ru overlay (TODO: translate from English). */
export const scans: Shape<typeof he> = {
  scannedInvoice: 'Scanned invoice',
  secureLink: 'Secure link',
  pages: '{count} pages',
  localCopy: 'Local copy (development)',
  notLoading: "Not loading? A popup blocker or a browser without a PDF viewer may be the cause.",
  openInTab: 'Open in a new tab',
};
