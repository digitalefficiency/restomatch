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
  {
    // W3-01 roll-up matrix: every branch side by side, one click from the chain
    // page. Inherits the chain page's owner gate; the bookkeeper's read-only
    // web entry comes with slice b (chain.matrix already serves her, decision 7).
    // The chain router re-checks the membership per branch.
    key: 'chainMatrix',
    path: '/dashboard/chain/matrix',
    group: 'chain',
    parent: 'chain',
    chain: 'only',
    nav: 'linked',
    aliases: ['כל הסניפים', 'מטריצת סניפים', 'matrix'],
  },
];
