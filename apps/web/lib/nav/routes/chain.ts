import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Chain (S8): owner-level money across branches + branch management. The
    // chain router re-checks owner membership in the DB per request.
    key: 'chain',
    path: '/dashboard/chain',
    group: 'chain',
    rank: 10,
    roles: ['owner'],
    chain: 'only',
    nav: 'item',
    aliases: ['רשת', 'סניפים', 'chain', 'branches'],
  },
];
