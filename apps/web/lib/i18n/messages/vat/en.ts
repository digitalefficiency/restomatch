import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  card: {
    title: 'VAT at risk — invoices without an allocation number',
    subtitle: 'A tax invoice above {threshold} without an allocation number — its VAT can’t be deducted. You have 6 months to fix it.',
    count: '{count} invoices',
    countOne: '1 invoice',
    amountLabel: 'VAT at risk',
    separate: 'Not part of the leak',
    cta: 'Ask the supplier for an allocation number',
    clear: 'Every invoice above {threshold} has an allocation number ✓',
    clearHint: 'Checked the last 6 months.',
    more: 'and {count} more invoices',
    noNumber: 'No allocation number',
    badNumber: 'Invalid allocation number',
    invoiceNo: 'Invoice {number}',
    noInvoiceNo: 'Invoice without a number',
    daysLeft: 'About {days} days left to deduct',
    lastDay: 'About the last day to deduct',
  },
  request: {
    title: 'Request to the supplier (Hebrew)',
    hint: 'Copy it and send it to the supplier. The system sends nothing.',
    copy: 'Copy the text',
    copied: 'Copied ✓',
    close: 'Close',
  },
  invoice: {
    badge: 'VAT at risk: {amount}',
    missing: 'No allocation number — the VAT cannot be deducted.',
    invalid: 'The allocation number on the invoice is invalid — the VAT cannot be deducted.',
    deadline: 'Deductible until about {date}, with a corrected invoice.',
    closed: 'The deduction window closed around {date}.',
  },
};
