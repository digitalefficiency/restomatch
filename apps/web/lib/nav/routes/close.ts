import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // W3-05a month close checklist: each step links to the queue where its number lives.
    // Owner and bookkeeper close; the manager reads (the same ₪ they see on approvals).
    key: 'close',
    path: '/dashboard/close',
    group: 'money',
    rank: 75,
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'item',
    aliases: ['סגירת חודש', 'סגירה חודשית', 'צ׳קליסט סגירה', 'month close', 'close'],
  },
];
