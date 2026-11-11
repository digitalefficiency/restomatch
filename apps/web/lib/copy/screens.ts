/**
 * The e2e copy budget per screen (MECHANISM §5.2/§5.4; W2-16 §5.4). `baseline` = today's measurement
 * with the §5.1 metric (folds closed, he, demo seed DEMO_TODAY=2026-10-25). Data (rows, list items,
 * cards) never counts, so a screen's number is its own copy and does not depend on spec order.
 * Re-baselined on train-C staging (841cdba9, 11.11; r4 on 45431599 after narrowing the data rule to
 * tbody, ARIA data rows and [data-record]/[data-row]); identical in isolation and after W2-04 + W2-08. Every adopting
 * PR lowers its screen's baseline; once a baseline reaches the type budget, set `baseline: 'type'`.
 */
export type ScreenType = 'phone' | 'dashboard' | 'detail';
export type Role = 'owner' | 'manager' | 'bookkeeper' | 'chef' | 'receiver' | 'anon';

export interface CopyBaseline {
  first: number;
  page: number;
  /** Unfolded blocks of >12 words. */
  blocks: number;
}

export const TYPE_BUDGET: Record<ScreenType, CopyBaseline & { phoneFirst?: number }> = {
  phone: { first: 45, page: 100, blocks: 0 },
  dashboard: { first: 150, page: 260, blocks: 1, phoneFirst: 60 },
  detail: { first: 110, page: 320, blocks: 3 },
};

export const VIEWPORT = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

export interface CopyScreen {
  id: string;
  route: string;
  role: Role;
  vp: keyof typeof VIEWPORT;
  type: ScreenType;
  baseline: CopyBaseline | 'type' | null;
  /** What changed at the last re-baseline (one line). */
  note?: string;
  /** The package that lowers this baseline (MECHANISM §6.4). */
  adopter: string;
}

export const SCREENS: CopyScreen[] = [
  // Phone task — 390×844
  { id: 'receiver-home', route: '/dashboard', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 25, page: 36, blocks: 0 }, adopter: 'W2-05' },
  { id: 'receiving-board', route: '/dashboard/receiving', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 24, page: 35, blocks: 0 }, adopter: 'W2-05' },
  { id: 'chef-home', route: '/dashboard', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 37, page: 37, blocks: 0 }, adopter: 'W2-08' },
  { id: 'count', route: '/dashboard/inventory/count', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 22, page: 22, blocks: 1 }, adopter: 'W2-07' },
  { id: 'manager-approvals', route: '/dashboard/approvals', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 12, page: 14, blocks: 0 }, note: 'approval cards are data (W2-04 desk); page copy only', adopter: 'W2-04' },
  { id: 'login', route: '/login', role: 'anon', vp: 'phone', type: 'phone', baseline: { first: 25, page: 25, blocks: 0 }, adopter: 'W2-16b' },
  { id: 'orders-new', route: '/dashboard/orders/new', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 17, page: 17, blocks: 0 }, adopter: 'W2-06' },
  // Dashboard — 1440×900
  { id: 'owner-home', route: '/dashboard', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 70, page: 70, blocks: 1 }, note: 'r4: headings + static lists count again; needs-you task lists are [data-record]', adopter: 'W2-08' },
  { id: 'approvals', route: '/dashboard/approvals', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 110, page: 110, blocks: 0 }, note: 'r4: column headers + static copy count; approval cards are [data-record] (W2-04 list)', adopter: 'W2-04' },
  { id: 'leaks', route: '/dashboard/leaks', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 178, page: 289, blocks: 2 }, note: 'r4: headers + static lists count; driver chips are [data-record]', adopter: 'W2-09' },
  { id: 'claims', route: '/dashboard/recovery', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 79, page: 159, blocks: 0 }, note: 'r4: table headers count; claim cards/rows are data', adopter: 'W2-10' },
  { id: 'suppliers', route: '/dashboard/suppliers', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 46, page: 50, blocks: 0 }, note: 'r4: column headers count again', adopter: 'W2-11' },
  { id: 'bookkeeper-home', route: '/dashboard', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 4, page: 4, blocks: 0 }, adopter: 'W2-08' },
  { id: 'pay-run', route: '/dashboard/approvals/pay-run', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 66, page: 89, blocks: 1 }, note: 'r4: table headers count; invoice cards/rows are data', adopter: 'W2-03' },
  { id: 'manager-home-phone', route: '/dashboard', role: 'manager', vp: 'phone', type: 'dashboard', baseline: { first: 6, page: 6, blocks: 0 }, adopter: 'W2-08' },
  // Detail — 1440×900
  { id: 'leak-proof', route: '/dashboard/leaks/proof', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 55, page: 160, blocks: 4 }, note: 'r4: method/rules lists count; per-invoice proof list is [data-record]', adopter: 'W2-09' },
  { id: 'settings', route: '/dashboard/settings', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 94, page: 467, blocks: 3 }, note: 'grew with train C (W2-14 rules, roles, account cards); r4: headers and rule lists count', adopter: 'W2-14' },
  { id: 'exports', route: '/dashboard/exports', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 100, page: 143, blocks: 2 }, note: 'r4: headers + static lists count; export history is data', adopter: 'W2-14' },
];

/** Relative-time strings ("לפני 3 דקות") drift; the ratchet absorbs this many words. */
export const SLACK = 3;
