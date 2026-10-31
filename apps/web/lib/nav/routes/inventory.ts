import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Inventory counting (flag `inventoryCount`): the chef/manager counts in the walk-in.
    key: 'inventory',
    path: '/dashboard/inventory',
    group: 'kitchen',
    rank: 20,
    roles: ['owner', 'manager', 'chef'],
    features: ['inventoryCount'],
    nav: 'item',
    bar: { chef: { slot: 2, label: 'count' } },
    aliases: ['ספירה', 'מלאי', 'inventory', 'count', 'stock'],
  },
  {
    key: 'inventoryCount',
    path: '/dashboard/inventory/count',
    group: 'kitchen',
    parent: 'inventory',
    nav: 'linked',
    field: true,
  },
  {
    key: 'inventoryDetail',
    path: '/dashboard/inventory/[countId]',
    group: 'kitchen',
    parent: 'inventory',
    nav: 'detail',
  },
];
