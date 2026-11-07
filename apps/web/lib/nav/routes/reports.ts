import type { RouteDef } from '../types';

// Owner decision I3 (7.11): the bookkeeper reads every month report, read-only (W3-08).
export const routes: RouteDef[] = [
  {
    // Prefix gate for every report (incl. monthly/pdf); no page of its own.
    key: 'reports',
    path: '/dashboard/reports',
    group: 'leaks',
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'hidden',
    gateOnly: true,
  },
  {
    // Exact entry too: nav visibility (canSeeRoute) is an exact-path lookup.
    key: 'monthlyReport',
    path: '/dashboard/reports/monthly',
    group: 'leaks',
    rank: 30,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['monthlyReport'],
    nav: 'item',
    aliases: ['דוח חודשי', 'דוחות', 'monthly', 'report'],
  },
  {
    key: 'digest',
    path: '/dashboard/reports/digest',
    group: 'leaks',
    parent: 'monthlyReport',
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'linked',
  },
];
