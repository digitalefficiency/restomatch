import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // One supplier invoice (prices, lines, image): opened from receiving, approvals
    // and the leak drill-down — never the chef. Mirrors receiving.getInvoice.
    // Gate-only until the invoice register (W2-02) gives it a page.
    key: 'invoices',
    path: '/dashboard/invoices',
    group: 'money',
    roles: ['owner', 'manager', 'receiver', 'bookkeeper'],
    nav: 'hidden',
    gateOnly: true,
  },
  {
    key: 'invoiceDetail',
    path: '/dashboard/invoices/[invoiceId]',
    group: 'money',
    parent: 'inbox',
    nav: 'detail',
  },
];
