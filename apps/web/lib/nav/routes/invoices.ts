import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // One supplier invoice (unit prices, line totals, VAT ₪, image): opened from
    // approvals, the inbox and the leak drill-down. Never the chef or the receiver
    // (owner decision: they see no ₪; the Delivery Check wizard reads
    // receiving.getInvoice over tRPC, not this page). The server-side ₪ strip is H-11.
    // Gate-only until the invoice register (W2-02) gives it a page.
    key: 'invoices',
    path: '/dashboard/invoices',
    group: 'money',
    roles: ['owner', 'manager', 'bookkeeper'],
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
