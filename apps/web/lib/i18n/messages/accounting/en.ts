import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Accounting exports',
  subtitle:
    'Every checked invoice — including invoices with an open gap (flagged in the file). CSV for spreadsheets, or the Israeli “uniform file” (1000) for bookkeeping software.',
  summary: {
    label: 'What the file will contain',
    loading: 'Counting the invoices in this range…',
    invoices: '{count} invoices',
    withGap: '{count} with an open gap',
    inDispute: 'under review with the supplier',
    none: 'No checked invoices in this range.',
    disputedNote: 'Invoices with an open gap are included and flagged in the “status” and “₪ under review with suppliers” columns — don’t post them as fully payable before the decision.',
    undated: '{count} without a date will be left out',
  },
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
  downloadedEmpty: 'No checked invoices in this range. The file downloaded empty (headers only).',
  undated: 'Not in the file — checked invoices from this range with no invoice date: {count}. Add the date on the invoice page and download again.',
  failed: 'Download failed.',
  note: 'Every checked invoice is included: “matched”, “disputed” (flagged in the status column), “approved” and “paid”. Invoices still in OCR, and consolidated invoices waiting for their delivery notes, are left out, as is a copy flagged as a duplicate invoice (unless the flag was rejected as “not a duplicate”). Dates follow Israel time.',
};
