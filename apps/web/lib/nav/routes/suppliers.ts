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
    // Supplier ledger grid (flag supplierLedger): every invoice reader, incl. the
    // bookkeeper's CSV — never the chef. Mirrors suppliers.ledgerGrid.
    // First nav path for the bookkeeper (SUP-01). Owner decision (2026-10-25):
    // the receiver sees no supplier ledger or ₪ screens — no nav entry; the
    // server-side block is H-11 (human PR), which then drops `receiver` here.
    key: 'ledger',
    path: '/dashboard/suppliers/ledger',
    group: 'money',
    rank: 60,
    roles: ['owner', 'manager', 'receiver', 'bookkeeper'],
    features: ['supplierLedger'],
    navHiddenFor: ['receiver'],
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
