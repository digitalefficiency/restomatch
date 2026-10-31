import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // One supplier invoice (unit prices, line totals, VAT ₪, image): opened from
    // approvals, the inbox and the leak drill-down. Never the chef or the receiver
    // (owner decision: they see no ₪; the Delivery Check wizard reads
    // receiving.getInvoice over tRPC, not this page). The server-side ₪ strip is H-11.
    // W2-02: the invoice register — the bookkeeper's bar slot 4 "invoices".
    key: 'invoices',
    path: '/dashboard/invoices',
    group: 'money',
    rank: 25,
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'item',
    bar: { bookkeeper: { slot: 4, label: 'invoices' } },
    aliases: ['חשבוניות', 'רשימת חשבוניות', 'invoices', 'invoice register'],
  },
  {
    key: 'invoiceDetail',
    path: '/dashboard/invoices/[invoiceId]',
    group: 'money',
    parent: 'inbox',
    nav: 'detail',
  },
];
