import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // S13 invoice inbox (WhatsApp / e-mail ingestion): managers act, bookkeepers read.
    // PLACEHOLDER until the invoice register (W2-02): the bookkeeper's "חשבוניות"
    // bar slot points here; W2-02 moves it to `/dashboard/invoices`.
    key: 'inbox',
    path: '/dashboard/inbox',
    group: 'money',
    rank: 30,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['ingestWhatsapp', 'ingestEmail'],
    nav: 'item',
    bar: { bookkeeper: { slot: 4, label: 'invoices' } },
    aliases: ['חשבוניות', 'תיבת חשבוניות', 'נכנסות', 'inbox', 'invoices'],
  },
];
