import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'catalog',
    path: '/dashboard/catalog',
    group: 'procure',
    rank: 40,
    roles: ['owner', 'manager'],
    nav: 'item',
    aliases: ['קטלוג', 'מוצרים', 'catalog', 'products'],
  },
  { key: 'catalogImport', path: '/dashboard/catalog/import', group: 'procure', parent: 'catalog', nav: 'linked' },
  { key: 'catalogMapping', path: '/dashboard/catalog/mapping', group: 'procure', parent: 'catalog', nav: 'linked' },
];
