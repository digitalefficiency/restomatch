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
];

/**
 * The ratchet allowance: the first lab measurement (7.11, demo seed, next dev, he, folds
 * closed; IA-01 report mode). Only metrics over budget are listed; `{}` = within budget.
 * Lower a number when your package adopts the budget; never raise one.
 */
export const BASELINE_0711: Record<string, Allowance> = {
  'home-owner-desk': { blocks: 10, numbers: 45, t2: 4, words: 216, pageWords: 303 },
  'home-owner-phone': { numbers: 21, t2: 4, words: 94, pageWords: 296 },
  'approvals-owner-desk': { primaryPerFold: 3, numbersPerRow: 14, t2PerRow: 2 },
  'recovery-owner-desk': { primaryPerFold: 3, minRowsDesk: 5 },
  'invoice-owner-desk': { blocks: 6 },
  'supplier-owner-desk': { t2: 2 },
  'home-manager-desk': { blocks: 7, numbers: 41, t2: 5, words: 193 },
  'home-manager-phone': { numbers: 19, t2: 5, words: 87 },
  'approvals-manager-phone': { numbersPerRow: 7 },
  'order-manager-desk': { blocks: 3 },
  'home-bookkeeper-desk': { blocks: 7, numbers: 40, words: 197 },
  'home-bookkeeper-phone': { numbers: 16, words: 82 },
  'pay-run-bookkeeper-desk': { numbersPerRow: 6, minRowsDesk: 3 },
  'inbox-bookkeeper-desk': { minRowsDesk: 2 },
  'home-chef-desk': {},
  'home-chef-phone': { blocks: 3, words: 61 },
  'home-receiver-desk': { blocks: 8, t2: 4 },
  'home-receiver-phone': { blocks: 5, numbers: 13, t2: 4, words: 72, pageWords: 111 },
  'receiving-receiver-phone': {},
};

export const DENSITY_SCREENS: DensityScreen[] = BASE.map((s) => ({ ...s, allow: BASELINE_0711[s.id] }));
