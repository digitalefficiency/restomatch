import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'orders',
    path: '/dashboard/orders',
    group: 'procure',
    rank: 10,
    // Owner decision 31.10 (pilot): the chef orders freely — sees, creates, sends, cancels.
    roles: ['owner', 'manager', 'chef'],
    nav: 'item',
    bar: {
      manager: { slot: 2, label: 'orders' },
      owner: { slot: 4, label: 'orders' },
      chef: { slot: 4, label: 'orders' },
    },
    aliases: ['הזמנה', 'הזמנות', 'orders', 'po'],
  },
  { key: 'ordersNew', path: '/dashboard/orders/new', group: 'procure', parent: 'orders', nav: 'linked', field: true },
  {
    key: 'ordersCapture',
    path: '/dashboard/orders/capture',
    group: 'procure',
    parent: 'orders',
    nav: 'linked',
    field: true,
  },
  { key: 'orderDetail', path: '/dashboard/orders/[poId]', group: 'procure', parent: 'orders', nav: 'detail' },
];
