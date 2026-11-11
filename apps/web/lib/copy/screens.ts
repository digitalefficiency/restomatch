/**
 * The e2e copy budget per screen (MECHANISM §5.2/§5.4; W2-16 §5.4). `baseline` = today's measurement
 * with the §5.1 metric (folds closed, he, demo seed; lab :3351 build ab9908c4, 31.10). Every adopting
 * PR lowers its screen's baseline; once a baseline reaches the type budget, set `baseline: 'type'`.
 * `null` = not measurable on the lab build yet; the spec seeds it on its first run (prints, never fails).
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
  { id: 'receiver-home', route: '/dashboard', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 48, page: 93, blocks: 1 }, adopter: 'W2-05' },
  { id: 'receiving-board', route: '/dashboard/receiving', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 50, page: 95, blocks: 1 }, adopter: 'W2-05' },
  { id: 'chef-home', route: '/dashboard', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 44, page: 44, blocks: 0 }, adopter: 'W2-08' },
  { id: 'count', route: '/dashboard/inventory/count', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 20, page: 20, blocks: 1 }, adopter: 'W2-07' },
  { id: 'manager-approvals', route: '/dashboard/approvals', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 53, page: 78, blocks: 0 }, adopter: 'W2-04' },
  { id: 'login', route: '/login', role: 'anon', vp: 'phone', type: 'phone', baseline: { first: 38, page: 38, blocks: 0 }, adopter: 'W2-16b' },
  { id: 'orders-new', route: '/dashboard/orders/new', role: 'chef', vp: 'phone', type: 'phone', baseline: null, adopter: 'W2-06' },
  // Dashboard — 1440×900
  { id: 'owner-home', route: '/dashboard', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 203, page: 323, blocks: 4 }, adopter: 'W2-08' },
  { id: 'approvals', route: '/dashboard/approvals', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 171, page: 233, blocks: 0 }, adopter: 'W2-04' },
  { id: 'leaks', route: '/dashboard/leaks', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 191, page: 321, blocks: 2 }, adopter: 'W2-09' },
  { id: 'claims', route: '/dashboard/recovery', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 135, page: 684, blocks: 9 }, adopter: 'W2-10' },
  { id: 'suppliers', route: '/dashboard/suppliers', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 91, page: 180, blocks: 2 }, adopter: 'W2-11' },
  { id: 'bookkeeper-home', route: '/dashboard', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 180, page: 236, blocks: 3 }, adopter: 'W2-08' },
  { id: 'pay-run', route: '/dashboard/approvals/pay-run', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 126, page: 343, blocks: 2 }, adopter: 'W2-03' },
  { id: 'manager-home-phone', route: '/dashboard', role: 'manager', vp: 'phone', type: 'dashboard', baseline: { first: 66, page: 266, blocks: 3 }, adopter: 'W2-08' },
  // Detail — 1440×900
  { id: 'leak-proof', route: '/dashboard/leaks/proof', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 81, page: 254, blocks: 5 }, adopter: 'W2-09' },
  { id: 'settings', route: '/dashboard/settings', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 114, page: 317, blocks: 4 }, adopter: 'W2-14' },
  { id: 'exports', route: '/dashboard/exports', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 126, page: 126, blocks: 3 }, adopter: 'W2-14' },
];

/** Relative-time strings ("לפני 3 דקות") drift; the ratchet absorbs this many words. */
export const SLACK = 3;
