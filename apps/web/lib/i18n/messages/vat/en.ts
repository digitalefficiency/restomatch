import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  card: {
    title: 'VAT at risk — invoices without an allocation number',
    subtitle:
      'A tax invoice above {threshold} before VAT without an allocation number cannot have its VAT deducted. You have 6 months from the invoice date to get a corrected invoice.',
    count: '{count} invoices',
    countOne: '1 invoice',
    amountLabel: 'VAT at risk',
    separate: 'Separate from the leak — this is VAT, not a supplier discrepancy.',
    cta: 'Ask the supplier for an allocation number',
    clear: 'Every invoice above {threshold} has an allocation number ✓',
    clearHint: 'Checked the tax invoices you can still deduct (the last 6 months).',
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
    hint: 'Copy it and send it to the supplier on WhatsApp or by e-mail. The system sends nothing.',
    copy: 'Copy the text',
    copied: 'Copied ✓',
    close: 'Close',
  },
  invoice: {
    badge: 'VAT at risk: {amount}',
    missing: 'No allocation number — the VAT cannot be deducted.',
    invalid: 'The allocation number on the invoice is invalid — the VAT cannot be deducted.',
    deadline: 'You can still deduct it until about {date} if a corrected invoice arrives.',
    closed: 'The 6-month deduction window (from the invoice date) closed around {date}.',
  },
};
