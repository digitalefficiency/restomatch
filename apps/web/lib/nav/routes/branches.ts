import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // In the chain group for a chain owner; a single-branch owner finds it under
    // ניהול ("open a branch").
    key: 'branches',
    path: '/dashboard/branches',
    group: 'chain',
    rank: 20,
    groupWhenSingle: 'admin',
    roles: ['owner'],
    nav: 'item',
    aliases: ['סניף', 'סניפים', 'branches'],
  },
];
