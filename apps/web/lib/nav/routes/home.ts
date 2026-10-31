import type { RouteDef } from '../types';

/** `/dashboard`: one home URL that renders by role (W1-05). */
export const routes: RouteDef[] = [
  {
    key: 'home',
    path: '/dashboard',
    group: 'top',
    rank: 10,
    roles: ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'],
    nav: 'item',
    bar: {
      owner: { slot: 1, label: 'home' },
      bookkeeper: { slot: 1, label: 'home' },
      manager: { slot: 1, label: 'today' },
      chef: { slot: 1, label: 'today' },
      receiver: { slot: 1, label: 'today' },
    },
    aliases: ['בית', 'סקירה', 'היום', 'home', 'overview', 'today'],
  },
];
