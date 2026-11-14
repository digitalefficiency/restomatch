import type { Allowance, ScreenType, Viewport } from './budget';

/**
 * IA-01 — the screens the density check measures first (KICKOFF-0711 §3 row IA: homes,
 * queues, records). `route` may hold `:invoice` / `:po` / `:supplier`, resolved from the
 * demo seed by the spec. `allow` is the ratchet allowance (budget.ts `newFindings`):
 * `undefined` until the first recorded measurement; the adopting package lowers it.
 */
export type Role = 'owner' | 'manager' | 'bookkeeper' | 'chef' | 'receiver';

export interface DensityScreen {
  id: string;
  route: string;
  role: Role;
  vp: Viewport;
  type: ScreenType;
  /** The package that brings this screen inside its budget (IA-SPEC §6). */
  adopter: string;
  allow?: Allowance;
}

const homes: DensityScreen[] = (['owner', 'manager', 'bookkeeper', 'chef', 'receiver'] as const).flatMap((role) =>
  (['desk', 'phone'] as const).map((vp) => ({
    id: `home-${role}-${vp}`,
    route: '/dashboard',
    role,
    vp,
    // The receiver's and the chef's phone homes are field screens (IA-SPEC rule 4 "שטח").
    type: (role === 'receiver' || role === 'chef') && vp === 'phone' ? ('field' as const) : ('home' as const),
    adopter: 'W2-08',
  })),
);

const BASE: DensityScreen[] = [
  ...homes,
  // Queues
  { id: 'approvals-owner-desk', route: '/dashboard/approvals', role: 'owner', vp: 'desk', type: 'queue', adopter: 'W2-04' },
  { id: 'approvals-manager-phone', route: '/dashboard/approvals', role: 'manager', vp: 'phone', type: 'queue', adopter: 'W2-04' },
  { id: 'recovery-owner-desk', route: '/dashboard/recovery', role: 'owner', vp: 'desk', type: 'queue', adopter: 'W2-10' },
  { id: 'pay-run-bookkeeper-desk', route: '/dashboard/approvals/pay-run', role: 'bookkeeper', vp: 'desk', type: 'queue', adopter: 'W2-03' },
  { id: 'inbox-bookkeeper-desk', route: '/dashboard/inbox', role: 'bookkeeper', vp: 'desk', type: 'queue', adopter: 'W2-02' },
  { id: 'receiving-receiver-phone', route: '/dashboard/receiving', role: 'receiver', vp: 'phone', type: 'queue', adopter: 'W2-05' },
  // Records
  { id: 'invoice-owner-desk', route: '/dashboard/invoices/:invoice', role: 'owner', vp: 'desk', type: 'record', adopter: 'W2-02' },
  { id: 'order-manager-desk', route: '/dashboard/orders/:po', role: 'manager', vp: 'desk', type: 'record', adopter: 'W2-06' },
  { id: 'supplier-owner-desk', route: '/dashboard/suppliers/:supplier', role: 'owner', vp: 'desk', type: 'record', adopter: 'W2-11' },
  // Audit (calm: 0 T2, every figure once)
  { id: 'leak-proof-owner-desk', route: '/dashboard/leaks/proof', role: 'owner', vp: 'desk', type: 'audit', adopter: 'W2-09' },
  { id: 'monthly-report-owner-desk', route: '/dashboard/reports/monthly', role: 'owner', vp: 'desk', type: 'audit', adopter: 'W3-08' },
  { id: 'ledger-bookkeeper-desk', route: '/dashboard/suppliers/ledger', role: 'bookkeeper', vp: 'desk', type: 'audit', adopter: 'W2-11' },
  // Field (the next item + one 56px button)
  { id: 'count-manager-phone', route: '/dashboard/inventory/count', role: 'manager', vp: 'phone', type: 'field', adopter: 'W2-07' },
  { id: 'dock-receiver-phone', route: '/dashboard/receiving/:po', role: 'receiver', vp: 'phone', type: 'field', adopter: 'W2-05' },
  // Setup (state row first, forms folded, 0 T2)
  { id: 'settings-owner-desk', route: '/dashboard/settings', role: 'owner', vp: 'desk', type: 'setup', adopter: 'W2-14' },
  { id: 'integrations-owner-desk', route: '/dashboard/integrations', role: 'owner', vp: 'desk', type: 'setup', adopter: 'W2-14' },
  { id: 'exports-bookkeeper-desk', route: '/dashboard/exports', role: 'bookkeeper', vp: 'desk', type: 'setup', adopter: 'W2-14' },
  { id: 'team-owner-desk', route: '/dashboard/team', role: 'owner', vp: 'desk', type: 'setup', adopter: 'W3-07b' },
];

/**
 * The ratchet allowance: re-measured on main@B (3d64808d, train B, 11.11; demo seed, next dev, he, folds
 * closed, the lab-only worker banner removed; IA-01 report mode). Only metrics over budget are listed; `{}` = within budget.
 * Lower a number when your package adopts the budget; never raise one.
 */
export const BASELINE_0711: Record<string, Allowance> = {
  'home-owner-desk': { blocks: 11, numbers: 52, words: 228, pageWords: 289 },
  'home-owner-phone': { blocks: 6, numbers: 24, words: 96, pageWords: 282 },
  'approvals-owner-desk': { primaryPerFold: 3, numbersPerRow: 8, t2PerRow: 2 },
  'recovery-owner-desk': { primaryPerFold: 4, minRowsDesk: 7 },
  'invoice-owner-desk': { numbersPerRow: 6 },
  'supplier-owner-desk': {},
  'leak-proof-owner-desk': {},
  'monthly-report-owner-desk': { t2: 4, t2PerRow: 1 },
  'settings-owner-desk': { primaryPerFold: 2 },
  'integrations-owner-desk': {},
  'team-owner-desk': {},
  'home-manager-desk': { blocks: 8, numbers: 52, t2: 4, words: 209 },
  'home-manager-phone': { numbers: 20, t2: 4, words: 82 },
  'approvals-manager-phone': { numbersPerRow: 13 },
  'order-manager-desk': { blocks: 4 },
  'count-manager-phone': {},
  'home-bookkeeper-desk': { blocks: 7, numbers: 50, words: 190 },
  'home-bookkeeper-phone': { numbers: 18, words: 78 },
  'pay-run-bookkeeper-desk': { primaryPerFold: 2, numbersPerRow: 7, minRowsDesk: 5 },
  'inbox-bookkeeper-desk': { minRowsDesk: 2 },
  'ledger-bookkeeper-desk': { t2: 21, t2PerRow: 4 },
  'exports-bookkeeper-desk': { primaryPerFold: 2 },
  'home-chef-desk': {},
  'home-chef-phone': {},
  'home-receiver-desk': { blocks: 8 },
  'home-receiver-phone': { blocks: 5, numbers: 16, words: 48 },
  'receiving-receiver-phone': {},
  'dock-receiver-phone': {},
};

export const DENSITY_SCREENS: DensityScreen[] = BASE.map((s) => ({ ...s, allow: BASELINE_0711[s.id] }));
