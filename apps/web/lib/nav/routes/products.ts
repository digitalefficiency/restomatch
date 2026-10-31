import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Product pages are part of the catalog (names grid, price history, cheapest
    // supplier); without this rule every role could open them by URL.
    key: 'products',
    path: '/dashboard/products',
    group: 'procure',
    parent: 'catalog',
    roles: ['owner', 'manager'],
    nav: 'linked',
  },
  { key: 'productDetail', path: '/dashboard/products/[productId]', group: 'procure', parent: 'products', nav: 'detail' },
];
