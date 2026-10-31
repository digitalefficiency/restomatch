import type { RouteDef } from '../types';

/**
 * Shell system pages. Registered ahead of W1-04, which adds the in-shell
 * forbidden page; every role may land on it, so it carries no gate.
 */
export const routes: RouteDef[] = [
  { key: 'forbidden', path: '/dashboard/forbidden', group: 'top', nav: 'hidden' },
  // Platform-admin style labs (W1-01 tokens, W1-02 desk). Each page 404s for anyone
  // who isn't a platform admin, so they stay out of every menu.
  { key: 'labTokens', path: '/dashboard/lab/tokens', group: 'top', nav: 'hidden' },
  { key: 'labDesk', path: '/dashboard/lab/desk', group: 'top', nav: 'hidden' },
  { key: 'labDeskRow', path: '/dashboard/lab/desk/[rowId]', group: 'top', parent: 'labDesk', nav: 'detail' },
];
