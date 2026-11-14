import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Inventory counting (flag `inventoryCount`): the chef/manager counts in the walk-in.
    // TODO(W2-07 → W2-08): add 'bookkeeper' (owner decision foodcost-20: the bookkeeper reads closed counts;
    // the server read tier already allows it). Blocked on nav-registry.test.ts's pinned ROUTE_ROLES_BEFORE /
    // "never loosens" check (W2-08's file) — needs that one-line exception first.
    key: 'inventory',
    path: '/dashboard/inventory',
    group: 'kitchen',
    rank: 20,
    // Owner decision (orchestrator, 7.11): the bookkeeper reads everything — read-only
    // here (W2-07 gives it a server read tier; counting writes stay chef/manager).
    roles: ['owner', 'manager', 'chef', 'bookkeeper'],
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
