import type { Shape } from '../../translate';
import type { he } from './he';

export const en: Shape<typeof he> = {
  mainLabel: 'Main navigation',
  mobileLabel: 'Quick navigation',
  skipToContent: 'Skip to content',
  links: {
    overview: 'Overview',
    receiving: 'Receiving',
    approvals: 'Approvals',
    leaks: 'Leak detective',
    suppliers: 'Suppliers',
    catalog: 'Catalog',
    orders: 'Orders',
    exports: 'Exports',
    team: 'Team',
    settings: 'Settings',
  },
  groups: {
    operations: 'Operations',
    purchasing: 'Purchasing',
    admin: 'Admin',
  },
  roles: {
    owner: 'Owner',
    manager: 'Manager',
    receiver: 'Receiver',
    bookkeeper: 'Bookkeeper',
    chef: 'Chef',
  },
  menu: {
    open: 'Open menu',
    close: 'Close menu',
    more: 'More',
    account: 'Account',
  },
  signOut: 'Sign out',
  search: {
    placeholder: 'Search suppliers, products, invoices…',
    shortPlaceholder: 'Search…',
    label: 'Global search',
    searching: 'Searching…',
    noResults: 'No results',
    minChars: 'Type at least 2 characters',
    error: 'Search failed. Please try again.',
    hint: 'Arrows to move · Enter to open · Esc to close',
    groups: {
      suppliers: 'Suppliers',
      products: 'Products',
      invoices: 'Invoices',
    },
    noInvoiceNumber: 'No number',
  },
  worker: {
    title: 'The processing engine is unavailable right now.',
    body: 'Invoices you upload are saved and will be OCR’d and matched as soon as it’s back.',
    lastBeat: 'Last heartbeat {minutes} min ago.',
    ownerNotified: 'The owner has been notified.',
  },
  loading: 'Loading',
};
