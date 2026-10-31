import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'suppliers',
    path: '/dashboard/suppliers',
    group: 'procure',
    rank: 30,
    roles: ['owner', 'manager'],
    nav: 'item',
    aliases: ['ספק', 'suppliers', 'vendors'],
  },
  {
    // Supplier ledger grid (flag supplierLedger): owner, manager and the
    // bookkeeper's CSV — never the chef. First nav path for the bookkeeper
    // (SUP-01). Owner decision (2026-10-25): the receiver sees no supplier
    // ledger or ₪ screens, so the route gate excludes them; the matching block
    // in suppliers.ledgerGrid is H-11 (human PR).
    key: 'ledger',
    path: '/dashboard/suppliers/ledger',
    group: 'money',
    rank: 60,
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['supplierLedger'],
    nav: 'item',
    aliases: ['כרטסת', 'כרט', 'הנה״ח', 'ledger'],
  },
  { key: 'supplierDetail', path: '/dashboard/suppliers/[id]', group: 'procure', parent: 'suppliers', nav: 'detail' },
  {
    key: 'supplierLeakCard',
    path: '/dashboard/suppliers/[id]/leak-card',
    group: 'procure',
    parent: 'supplierDetail',
    nav: 'detail',
  },
];
