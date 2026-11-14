import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // S13 invoice inbox (WhatsApp / e-mail ingestion): owner, manager and bookkeeper
    // approve intake (G-07 intake.approve). The bookkeeper's bar slot 4 moved to the
    // register (`/dashboard/invoices`, W2-02); the inbox is its "נכנסות" tab.
    // `?view=settings` = intake addresses + approved senders (off the queue).
    key: 'inbox',
    path: '/dashboard/inbox',
    group: 'money',
    rank: 30,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['ingestWhatsapp', 'ingestEmail'],
    nav: 'item',
    aliases: ['תיבת חשבוניות', 'נכנסות', 'inbox'],
  },
];
