import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  title: 'Approvals queue',
  subtitle:
    'Discrepancies waiting for your decision. Approve = claim the money back from the supplier (counts as savings). Reject = let it go; the decision is logged.',
  empty: {
    title: 'Nothing waiting for you',
    description:
      'Every discrepancy has been handled. New ones appear here as soon as the system spots them in receipts and invoices.',
  },
  summary: {
    inQueue: 'In queue',
    atRisk: 'Amount at risk',
    blockers: 'Blockers',
  },
  card: {
    estimatedLoss: 'Estimated loss',
    invoice: 'Invoice {number}',
    fixInvoice: 'Open invoice / fix OCR',
    whyFlagged: 'Why was this flagged?',
    expected: 'Expected',
    actual: 'Actual',
    threshold: 'Threshold',
    routing: 'Routed by',
    reject: 'Reject',
    approve: 'Approve',
    escalate: 'Escalate to owner',
    cancel: 'Cancel',
    confirmReject: 'Confirm rejection',
    rejectReason: 'Reason for rejecting (required)',
    error: 'That did not go through. Please try again.',
    forbidden: 'You are not allowed to decide this discrepancy.',
    loadMore: 'Load more',
  },
  severity: {
    block: 'Blocker',
    warn: 'Warning',
    info: 'Info',
  },
  resolution: {
    open: 'Open',
    accepted: 'Claimed',
    rejected: 'Waived',
    escalated: 'Escalated',
    resolved: 'Resolved',
  },
  types: {
    PRICE_HIGHER: {
      label: 'Price above expected',
      explain: 'The supplier charged a higher unit price than the order or the historical price.',
    },
    PRICE_LOWER: {
      label: 'Price below expected',
      explain: 'The supplier charged less than expected — not a leak, just for your information.',
    },
    QTY_SHORT: {
      label: 'Short delivery',
      explain: 'Fewer units arrived than were ordered.',
    },
    QTY_OVER: {
      label: 'Billed for more than received',
      explain: 'The invoice charges for units that were not recorded on the goods receipt.',
    },
    UNORDERED_ITEM: {
      label: 'Item not on the order',
      explain: 'An invoice line with no matching purchase-order line.',
    },
    MISSING_ON_INVOICE: {
      label: 'Ordered line not billed',
      explain: 'An ordered item is missing from the invoice — it may arrive on another invoice.',
    },
    UNIT_MISMATCH: {
      label: 'Unit mismatch',
      explain: 'The invoice unit differs from the order unit and cannot be converted.',
    },
    UNORDERED_ARRIVAL: {
      label: 'Waiting for a PO link',
      explain:
        'No matching purchase order was found — usually a consolidated invoice or one outside the date window. Not counted as a leak until linked.',
    },
    DUPLICATE_INVOICE: {
      label: 'Duplicate invoice',
      explain: 'This invoice number was already received from the same supplier — risk of paying twice.',
    },
    DATE_ANOMALY: {
      label: 'Unusual date',
      explain: 'The invoice date is more than a week away from the expected delivery.',
    },
    VAT_MISMATCH: {
      label: 'VAT mismatch',
      explain: 'The VAT amount does not match the VAT rate applied to the pre-VAT total.',
    },
    TOTAL_MISMATCH: {
      label: 'Total does not match lines',
      explain: 'The sum of the lines differs from the total printed on the invoice.',
    },
  },
  tolerance: {
    price: 'price ±{pct} or {amount}',
    qty: 'quantity ±{pct} or {units} units',
    duplicate: 'invoice number unique per supplier',
    date: '±{days} days from the expected delivery',
    poRequired: 'every invoice needs a purchase order',
    unit: 'unit must match between the order and the invoice',
    billedOverReceived: 'billed quantity exceeds the received quantity',
    missingLine: 'every order line must appear on the invoice',
    unorderedLine: 'every invoice line must match an order line',
    total: '±{amount}',
    vat: '{rate} VAT on the subtotal, ±{amount}',
    p90: 'above the historical 90th percentile ({amount})',
  },
  rules: {
    'duplicate-invoice': 'Duplicate invoice — payment blocked (bookkeeping)',
    'large-invoice-without-po': 'Large invoice with no order — owner approval',
    'unordered-item-significant': 'Significant unordered item — owner approval',
    'severity-block': 'High severity — owner approval',
    'cumulative-large': 'Large total difference on the invoice — owner',
    'cumulative-medium': 'Medium total difference on the invoice — manager',
    'minor-info': 'Negligible difference — auto-approved',
    fallback: 'Default — manager',
  },
};
