/**
 * The e2e copy budget per screen (MECHANISM §5.2/§5.4; W2-16 §5.4). `baseline` = the measurement with the
 * §5.1 metric (folds closed, he) in W2-16's OWN state: e2e/helpers/copyState.ts makes every chrome section
 * that only shows with certain data present (the question line, all five pay-run due buckets, the undated
 * exports note, the leaks cap note, "ממתין לאחרים", the VAT / duplicate lines, the hero's waiting lines, the
 * receiving board's summary and next truck), with rows dated from the DB clock (Israel day) in beforeAll and
 * removed in afterAll; the contracts demo is seeded too (the pilot runs with `contracts` ON). Data (rows,
 * list items, cards) never counts, and the first screen is measured with the record rows collapsed, so a
 * screen's number is its own copy: the same whatever the seed day (DEMO_TODAY is not pinned in e2e) and
 * whatever earlier specs left behind.
 * History: re-baselined on train-C staging (841cdba9, 11.11); r4 on 45431599 (data rule narrowed to tbody,
 * ARIA data rows and [data-record]/[data-row]); r5 on 2aa89099 (remaining record lists marked); r7 on
 * f4d78891f: measured in the copyState state, every screen in Hebrew (the receiver's saved English no longer
 * switches the words), first screen with records collapsed — identical in 5 states (fresh today, seeded
 * yesterday, seeded 3 days ago, CI order after g3 + W2-02..W2-15, after g4). Every adopting PR lowers its
 * screen's baseline; once a baseline reaches the type budget, set `baseline: 'type'`.
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
  { id: 'receiver-home', route: '/dashboard', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 24, page: 24, blocks: 0 }, note: 'r7: Hebrew (was the seed receiver\'s English); first with records collapsed: the no-PO note is first-screen', adopter: 'W2-05' },
  { id: 'receiving-board', route: '/dashboard/receiving', role: 'receiver', vp: 'phone', type: 'phone', baseline: { first: 26, page: 26, blocks: 0 }, note: 'r7: Hebrew (was the seed receiver\'s English); first with records collapsed: the no-PO note is first-screen', adopter: 'W2-05' },
  { id: 'chef-home', route: '/dashboard', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 46, page: 46, blocks: 0 }, note: "r7: + the question line 'N מוצרים מחכים לשאלה: זה אותו מוצר?' + 'ענו על השאלות' (9)", adopter: 'W2-08' },
  { id: 'count', route: '/dashboard/inventory/count', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 22, page: 22, blocks: 1 }, adopter: 'W2-07' },
  { id: 'manager-approvals', route: '/dashboard/approvals', role: 'manager', vp: 'phone', type: 'phone', baseline: { first: 25, page: 25, blocks: 0 }, note: "approval cards are data (W2-04 desk); r7: + the duplicate (4) and VAT (5) lines under the tiles; 'ממתין לאחרים' + 'צפייה בלבד' are first-screen with records collapsed", adopter: 'W2-04' },
  { id: 'login', route: '/login', role: 'anon', vp: 'phone', type: 'phone', baseline: { first: 25, page: 25, blocks: 0 }, adopter: 'W2-16b' },
  { id: 'orders-new', route: '/dashboard/orders/new', role: 'chef', vp: 'phone', type: 'phone', baseline: { first: 17, page: 17, blocks: 0 }, adopter: 'W2-06' },
  // Dashboard — 1440×900
  { id: 'owner-home', route: '/dashboard', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 100, page: 100, blocks: 2 }, note: "r7: + the question line (9), the hero's awaiting-question (15 + 'לשאלות') and awaiting-count (5) lines", adopter: 'W2-08' },
  { id: 'approvals', route: '/dashboard/approvals', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 101, page: 101, blocks: 0 }, note: "approval cards and supplier options are [data-record]; r7: + the duplicate (4) and VAT (5) lines, 'ממתין לאחרים' + 'צפייה בלבד' (4)", adopter: 'W2-04' },
  { id: 'leaks', route: '/dashboard/leaks', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 157, page: 247, blocks: 2 }, note: "r5: + the 'מעל החוזה' card (contracts seeded); r7: + the cap note 'סכום שורות הפער לפני תקרת החשבונית…' (12); first with records collapsed: + 'סה״כ'", adopter: 'W2-09' },
  { id: 'claims', route: '/dashboard/recovery', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 92, page: 92, blocks: 0 }, note: "claim rows, per-supplier credit rows and the pager are data; r7: first with records collapsed: 'זיכויים לרישום לפי ספק' + its hint (13) are first-screen", adopter: 'W2-10' },
  { id: 'suppliers', route: '/dashboard/suppliers', role: 'owner', vp: 'desktop', type: 'dashboard', baseline: { first: 50, page: 50, blocks: 0 }, note: "r4: column headers count again; r7: first with records collapsed: the grid footer 'מוצגות … מתוך …' + 'סה״כ (… שורות)' (4)", adopter: 'W2-11' },
  { id: 'bookkeeper-home', route: '/dashboard', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 4, page: 4, blocks: 0 }, adopter: 'W2-08' },
  { id: 'pay-run', route: '/dashboard/approvals/pay-run', role: 'bookkeeper', vp: 'desktop', type: 'dashboard', baseline: { first: 80, page: 128, blocks: 1 }, note: "invoice rows are data; r7: all five due buckets (heading + 11-word header row each: + 'באיחור', 'שבוע הבא', 'בלי מועד תשלום'); first with records collapsed", adopter: 'W2-03' },
  { id: 'manager-home-phone', route: '/dashboard', role: 'manager', vp: 'phone', type: 'dashboard', baseline: { first: 15, page: 15, blocks: 0 }, note: "r7: + the question line 'N מוצרים מחכים לשאלה: זה אותו מוצר?' + 'ענו על השאלות' (9)", adopter: 'W2-08' },
  // Detail — 1440×900
  { id: 'leak-proof', route: '/dashboard/leaks/proof', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 69, page: 171, blocks: 4 }, note: "per-invoice proof list is [data-record]; r7: + the awaiting-question line (10 + 'לשאלות'); first with records collapsed: + 'סה״כ N החשבוניות…' (3)", adopter: 'W2-09' },
  { id: 'settings', route: '/dashboard/settings', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 94, page: 465, blocks: 3 }, note: 'grew with train C (W2-14 rules, roles, account cards); r4: headers and rule lists count; r5: the random referral code is [data-record]', adopter: 'W2-14' },
  { id: 'exports', route: '/dashboard/exports', role: 'owner', vp: 'desktop', type: 'detail', baseline: { first: 104, page: 147, blocks: 2 }, note: "export history is data; r7: + 'N בלי תאריך לא ייכללו' (4)", adopter: 'W2-14' },
];

/** Relative-time strings ("לפני 3 דקות") drift; the ratchet absorbs this many words. */
export const SLACK = 3;
