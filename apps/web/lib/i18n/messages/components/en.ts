import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  spinner: { loading: 'Loading' },
  loadMore: { label: 'Load more' },
  breadcrumbs: { label: 'Breadcrumb' },
  toast: {
    region: 'Notifications',
    dismiss: 'Dismiss notification',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'Can’t reach the server. Check your connection and try again.',
    forbidden: 'You don’t have permission to do that.',
    notFound: 'Not found — it may have been deleted.',
    validation: 'Some fields are invalid. Please check and try again.',
    tooMany: 'Too many attempts. Wait a moment and try again.',
  },
  entitlement: {
    features: {
      advanced_analytics: 'Advanced analytics',
      accounting_export: 'Accounting export',
      whatsapp_alerts: 'WhatsApp alerts',
      integrations: 'Integrations',
    },
    compactTitle: 'Upgrade to unlock {feature}',
    compactBody: 'This feature is available on paid plans.',
    compactCta: 'See plans',
    title: 'Upgrade your plan to unlock {feature}',
    body: '{feature} is available on paid plans. Upgrade your account for full access.',
    cta: 'See plans & upgrade',
  },
  errorNotice: { title: 'Something went wrong' },
  activity: {
    types: {
      invoice_received: 'Invoice received',
      invoice_matched: 'Invoice matched',
      discrepancy_approved: 'Discrepancy approved',
      discrepancy_rejected: 'Discrepancy rejected',
      alias_learned: 'Learned a product name',
      sync_completed: 'Sync completed',
      other: 'Update',
    },
    invoiceMatchedNumbered: 'Invoice {number} matched',
    discrepancies: '{count} discrepancies',
    potentialLoss: 'potential loss {amount}',
    savings: 'saved {amount}',
    empty: 'No activity yet.',
  },
};
