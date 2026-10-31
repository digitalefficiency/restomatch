import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Wave 1 (S12): ₪-back tracker = finance roles (like leaks).
    key: 'recovery',
    path: '/dashboard/recovery',
    group: 'money',
    rank: 50,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['recovery'],
    nav: 'item',
    aliases: ['₪ חוזר', 'זיכויים', 'מעקב', 'recovery', 'credits'],
  },
];
