import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Wave-1 contracts + price alerts: finance tier, same as the contracts/priceAlerts
    // routers (financeProcedure). The nav entry is additionally feature-flag gated.
    key: 'contracts',
    path: '/dashboard/contracts',
    group: 'procure',
    rank: 50,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['contracts', 'priceAlerts'],
    nav: 'item',
    aliases: ['חוזה', 'חוזים', 'התראות מחיר', 'contracts', 'price alerts'],
  },
  {
    key: 'contractsImport',
    path: '/dashboard/contracts/import',
    group: 'procure',
    parent: 'contracts',
    nav: 'linked',
  },
];
