import type { RouteDef } from '../types';

/**
 * Shell system pages. Registered ahead of W1-04, which adds the in-shell
 * forbidden page; every role may land on it, so it carries no gate.
 */
export const routes: RouteDef[] = [{ key: 'forbidden', path: '/dashboard/forbidden', group: 'top', nav: 'hidden' }];
