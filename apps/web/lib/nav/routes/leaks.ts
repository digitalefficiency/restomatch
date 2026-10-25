import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'leaks',
    path: '/dashboard/leaks',
    group: 'leaks',
    rank: 10,
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'item',
    bar: { owner: { slot: 3, label: 'leaks' } },
    aliases: ['דליפות', 'בלש דליפות', 'leak', 'leaks', 'detective'],
  },
  { key: 'leaksBreakdown', path: '/dashboard/leaks/breakdown', group: 'leaks', parent: 'leaks', nav: 'linked' },
  {
    // S12 leakProof: the proof sheet lists invoice-level detail (like the breakdown).
    key: 'leaksProof',
    path: '/dashboard/leaks/proof',
    group: 'leaks',
    rank: 20,
    parent: 'leaks',
    roles: ['owner', 'manager', 'bookkeeper'],
    features: ['leakProof'],
    nav: 'item',
    aliases: ['הוכחה', 'proof'],
  },
  {
    // Now explicit (leaks-22): the printable report calls owner.leakReport, a
    // managerProcedure — the bookkeeper used to land on a warn "owner only" card.
    key: 'leaksReport',
    path: '/dashboard/leaks/report',
    group: 'leaks',
    parent: 'leaks',
    roles: ['owner', 'manager'],
    nav: 'linked',
    aliases: ['דוח דליפות', 'pdf', 'report'],
  },
  {
    // Claims to send (an orphan before the registry): a money item.
    key: 'claims',
    path: '/dashboard/leaks/claims',
    group: 'money',
    rank: 40,
    parent: 'leaks',
    nav: 'item',
    aliases: ['זיכויים', 'דרישה', 'מכתב', 'claims', 'credits'],
  },
];
