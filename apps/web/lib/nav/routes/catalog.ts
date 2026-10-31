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
  // G-08: the chef answers "זה אותו מוצר?" here (name questions only, no ₪); the
  // rest of /dashboard/catalog stays owner + manager.
  {
    key: 'catalogMapping',
    path: '/dashboard/catalog/mapping',
    group: 'procure',
    parent: 'catalog',
    nav: 'linked',
    roles: ['owner', 'manager', 'chef'],
  },
];
