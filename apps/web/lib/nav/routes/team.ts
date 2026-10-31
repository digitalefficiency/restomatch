import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    // Team: owners manage the roster; managers see it read-only and may set a
    // member's app language (e.g. an English-speaking receiver).
    key: 'team',
    path: '/dashboard/team',
    group: 'admin',
    rank: 10,
    roles: ['owner', 'manager'],
    nav: 'item',
    aliases: ['צוות', 'עובדים', 'team', 'users'],
  },
];
