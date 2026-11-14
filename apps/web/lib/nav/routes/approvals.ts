import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'approvals',
    path: '/dashboard/approvals',
    group: 'money',
    rank: 10,
    // Bookkeeper included: duplicate invoices are routed to them (approvals engine),
    // and approvals.approve/reject/escalate accept bookkeeper-routed items.
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'item',
    bar: {
      owner: { slot: 2, label: 'approvals' },
      bookkeeper: { slot: 2, label: 'approvals' },
      manager: { slot: 4, label: 'approvals' },
    },
    aliases: ['אש', 'תור אישורים', 'approvals', 'queue'],
  },
  {
    // W2-04: the notification landing (push / e-mail "דרושה החלטה"): one invoice's
    // gaps. Roles come from the parent (longest-prefix match on /dashboard/approvals).
    key: 'approvalInvoice',
    path: '/dashboard/approvals/[invoiceId]',
    group: 'money',
    parent: 'approvals',
    nav: 'detail',
  },
  {
    // The bookkeeper's main job (approvals-52): a first-class nav entry.
    key: 'payRun',
    path: '/dashboard/approvals/pay-run',
    group: 'money',
    rank: 20,
    parent: 'approvals',
    features: ['payRun'],
    nav: 'item',
    bar: { bookkeeper: { slot: 3, label: 'payments' } },
    aliases: ['תשלומים', 'ריצה', 'pay run', 'payments'],
  },
];
