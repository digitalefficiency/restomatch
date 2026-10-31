import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'receiving',
    path: '/dashboard/receiving',
    group: 'procure',
    rank: 20,
    roles: ['owner', 'manager', 'receiver'],
    nav: 'item',
    bar: {
      manager: { slot: 3, label: 'receive' },
      receiver: { slot: 2, label: 'receipts' },
    },
    aliases: ['קבלה', 'קב', 'קליטת סחורה', 'משלוח', 'receiving', 'delivery'],
  },
  {
    key: 'receivingPo',
    path: '/dashboard/receiving/[poId]',
    group: 'procure',
    parent: 'receiving',
    nav: 'detail',
    field: true,
  },
];
