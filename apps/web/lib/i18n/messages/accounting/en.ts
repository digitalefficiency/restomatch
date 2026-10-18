import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Accounting exports',
  subtitle:
    'Export approved invoices to structured files — CSV for spreadsheets, or the Israeli “uniform file” (1000) for direct upload to bookkeeping software.',
  range: 'Date range',
  from: 'From',
  to: 'To',
  presets: {
    label: 'Quick ranges',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    last30: 'Last 30 days',
    thisYear: 'This year',
  },
  rangeInvalid: 'The start date is after the end date.',
  rangeMissing: 'Choose a start and an end date.',
  csv: {
    title: 'CSV',
    body: 'For Excel / Google Sheets (opens correctly with Hebrew text)',
    button: 'Download CSV',
  },
  uniform: {
    title: 'Uniform file (1000)',
    body: 'For bookkeeping software / the Israel Tax Authority',
    button: 'Download uniform file',
  },
  downloaded: 'Downloaded — {count} invoices.',
  downloadedEmpty: 'No approved invoices in this range. The file downloaded empty (headers only).',
  failed: 'Download failed.',
  note: 'Only invoices with status “matched”, “approved” or “paid” are included. Invoices with open discrepancies are left out.',
};
