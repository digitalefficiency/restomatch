import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'orders',
    path: '/dashboard/orders',
    group: 'procure',
    rank: 10,
    roles: ['owner', 'manager'],
    nav: 'item',
    bar: {
      manager: { slot: 2, label: 'orders' },
      owner: { slot: 4, label: 'orders' },
    },
    aliases: ['הזמנה', 'הזמנות', 'orders', 'po'],
  },
  { key: 'ordersNew', path: '/dashboard/orders/new', group: 'procure', parent: 'orders', nav: 'linked', field: true },
  {
    key: 'ordersCapture',
    path: '/dashboard/orders/capture',
    group: 'procure',
    parent: 'orders',
    // The WhatsApp share target never 404s/403s (W2-06 §5.4, orders-17): a role that
    // cannot order gets the in-shell "העבירו למנהל" page. Linked only: no nav entry.
    roles: ['owner', 'manager', 'chef', 'receiver', 'bookkeeper'],
    nav: 'linked',
    field: true,
  },
  { key: 'orderDetail', path: '/dashboard/orders/[poId]', group: 'procure', parent: 'orders', nav: 'detail' },
];
