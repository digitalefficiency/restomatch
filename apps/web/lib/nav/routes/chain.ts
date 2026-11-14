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
    badge: null,
    aliases: ['רשת', 'סניפים', 'chain', 'branches'],
  },
  {
    // W3-01 roll-up matrix: every branch side by side, one click from the chain
    // page. The owner, and the chain's bookkeeper read-only (decision 7: the
    // bookkeeper reads everything). The chain router re-checks the membership
    // per branch.
    key: 'chainMatrix',
    path: '/dashboard/chain/matrix',
    group: 'chain',
    parent: 'chain',
    roles: ['owner', 'bookkeeper'],
    chain: 'only',
    nav: 'linked',
    // #251: every /dashboard/chain* route declares its badge; the matrix has none.
    badge: null,
    aliases: ['כל הסניפים', 'מטריצת סניפים', 'matrix'],
  },
];
