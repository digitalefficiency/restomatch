/**
 * The e2e copy budget per screen (MECHANISM §5.2/§5.4; W2-16 §5.4). `baseline` = today's measurement
 * with the §5.1 metric (folds closed, he, demo seed DEMO_TODAY=2026-10-25), re-seeded on main@B
 * (3d64808d + #204, lab :3416, 11.11); the 31.10 audit numbers predate trains A and B. Every adopting
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
  /** The package that lowers this baseline (MECHANISM §6.4). */
  adopter: string;
}

export const SCREENS: CopyScreen[] = [
  // Phone task — 390×844
  { id: 'receiver-home', route: '/dashboard', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 43, page: 87, blocks: 1 }, adopter: 'W2-05' },
  { id: 'receiving-board', route: '/dashboard/receiving', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 42, page: 86, blocks: 1 }, adopter: 'W2-05' },
  { id: 'chef-home', route: '/dashboard', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 44, page: 44, blocks: 0 }, adopter: 'W2-08' },
  { id: 'count', route: '/dashboard/inventory/count', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 20, page: 20, blocks: 1 }, adopter: 'W2-07' },
  { id: 'manager-approvals', route: '/dashboard/approvals', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 65, page: 138, blocks: 0 }, adopter: 'W2-04' },
  { id: 'login', route: '/login', role: 'anon', vp: 'phone', type: 'phone', baseline: { first: 37, page: 37, blocks: 0 }, adopter: 'W2-16b' },
  { id: 'orders-new', route: '/dashboard/orders/new', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 35, page: 35, blocks: 0 }, adopter: 'W2-06' },
  // Dashboard — 1440×900
  { id: 'owner-home', route: '/dashboard', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 212, page: 289, blocks: 4 }, adopter: 'W2-08' },
  { id: 'approvals', route: '/dashboard/approvals', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 181, page: 359, blocks: 1 }, adopter: 'W2-04' },
  { id: 'leaks', route: '/dashboard/leaks', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 193, page: 289, blocks: 2 }, adopter: 'W2-09' },
  { id: 'claims', route: '/dashboard/recovery', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 78, page: 163, blocks: 1 }, adopter: 'W2-10' },
  { id: 'suppliers', route: '/dashboard/suppliers', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 113, page: 204, blocks: 0 }, adopter: 'W2-11' },
  { id: 'bookkeeper-home', route: '/dashboard', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 180, page: 219, blocks: 3 }, adopter: 'W2-08' },
  { id: 'pay-run', route: '/dashboard/approvals/pay-run', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 112, page: 337, blocks: 2 }, adopter: 'W2-03' },
  { id: 'manager-home-phone', route: '/dashboard', role: 'manager', vp: 'phone', type: 'dashboard', baseline: { first: 82, page: 232, blocks: 3 }, adopter: 'W2-08' },
  // Detail — 1440×900
  { id: 'leak-proof', route: '/dashboard/leaks/proof', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 81, page: 242, blocks: 4 }, adopter: 'W2-09' },
  { id: 'settings', route: '/dashboard/settings', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 119, page: 344, blocks: 4 }, adopter: 'W2-14' },
  { id: 'exports', route: '/dashboard/exports', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 127, page: 127, blocks: 3 }, adopter: 'W2-14' },
];

/** Relative-time strings ("לפני 3 דקות") drift; the ratchet absorbs this many words. */
export const SLACK = 3;
