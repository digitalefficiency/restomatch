import type { RouteDef } from '../types';

export const routes: RouteDef[] = [
  {
    key: 'leaks',
    path: '/dashboard/leaks',
    group: 'leaks',
    rank: 10,
    roles: ['owner', 'manager', 'bookkeeper'],
    nav: 'item',
    bar: { owner: { slot: 3, label: 'leak' } },
    // The monthly leak hub (W1-08): its h1 is "דליפה". Price creep ("מחירים שעלו")
    // is a section of this page (`#prices`), so search still finds it by those words.
    aliases: [
      'דליפה',
      'דליפות',
      'מחירים',
      'מחירים שעלו',
      'זחילת מחירים',
      'בלש',
      'leak',
      'leaks',
      'price',
      'prices',
      'price creep',
      'detective',
    ],
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
    // Owner decision I4 (7.11): one copy of the month — the proof leaves the side
    // menu (interim, via W2-08). It stays reachable from the home hero's "איך הגענו?"
    // and by URL; W3-08 folds it into "דוח החודש".
    nav: 'hidden',
    aliases: ['הוכחה', 'proof'],
  },
  {
    // Inherits the /leaks gate. The bookkeeper reaches it from the leaks page and
    // gets the page's own role card until owner.leakReport admits them (owner
    // decision: the bookkeeper reads everything); a gate here would turn that
    // button into a silent bounce home.
    key: 'leaksReport',
    path: '/dashboard/leaks/report',
    group: 'leaks',
    parent: 'leaks',
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
    // 'דרישה' stays: people type the old word (orchestrator, 7.11 wording).
    aliases: ['זיכויים', 'בקשה', 'בקשות', 'דרישה', 'מכתב', 'claims', 'credits'],
  },
];
