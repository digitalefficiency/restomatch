import type { UserRole } from '@restomatch/db';
import type { GroupKey } from './types';

/**
 * Sidebar groups, in job order. `top` renders flat (no header); `admin` sits in
 * the sidebar footer with help and the accessibility statement.
 * Labels: `nav.groups.<key>`.
 */
export const GROUP_ORDER: readonly GroupKey[] = ['top', 'money', 'leaks', 'procure', 'kitchen', 'chain', 'admin'];

/** Groups rendered in the sidebar footer instead of the main list. */
export const FOOTER_GROUPS: readonly GroupKey[] = ['admin'];

/** Sidebar spec §4.2, one row per role. The footer group (ניהול) is in no row. */
const DEFAULT_OPEN: Readonly<Record<UserRole, readonly GroupKey[]>> = {
  owner: ['money', 'leaks'],
  manager: ['money', 'procure'],
  bookkeeper: ['money', 'leaks'],
  chef: [],
  receiver: [],
};

/**
 * Groups expanded by default on desktop, per role (sidebar spec §4.2). Each
 * role opens the two groups that hold its daily money work, and nothing more:
 * the owner and the bookkeeper get כסף + ניתוח (דליפה is a top-3 owner job;
 * סקירת רשת is also in the branch switcher), the manager gets כסף + רכש (the
 * ₪ to approve plus הזמנות and קבלה one click away). With both defaults open,
 * the spec measured 0 px overflow for owner, manager and bookkeeper at
 * 1440×900, 1536×864, 1366×768 and 1280×800, so the fit rule (`planFolds`)
 * has nothing to fold there. Chef and receiver get a flat rail with no
 * groups, so nothing opens. The footer group (ניהול) never opens by default.
 *
 * Callers layer on top of this: the group holding the current page always
 * opens, and the user's own toggles (`readGroupState`) win over the defaults.
 * With no role (`lib/nav/index.ts` re-exports this to callers that may hold
 * no viewer), or a role value this build does not know at runtime, the owner
 * row applies. The lookup checks own keys only, so a value such as
 * `constructor` gets that row too instead of an inherited object member.
 */
export function defaultOpenGroups(role?: UserRole): GroupKey[] {
  const row = role !== undefined && Object.hasOwn(DEFAULT_OPEN, role) ? DEFAULT_OPEN[role] : DEFAULT_OPEN.owner;
  return [...row];
}

/** What the fit rule needs to know about the panel right now. The shell measures every px value. */
export interface FoldInput {
  /** px the panel overflows by: `scrollHeight - clientHeight` of the scroll region (the pinned footer counts too). */
  overflow: number;
  /** Groups currently open in the panel. */
  open: readonly GroupKey[];
  /** Monotonic sequence number of each group's last open; missing = 0 (the oldest). */
  openedAt: Partial<Record<GroupKey, number>>;
  /** The group the user just opened. Folding it would undo their click. */
  justOpened?: GroupKey | null;
  /** The group holding the current page. Its "you are here" row must stay visible. */
  here?: GroupKey | null;
  /** Groups that carry a T2 ₪ badge. Money never hides behind a fold. */
  holdsT2: readonly GroupKey[];
  /** px recovered by folding each group: its list height plus its margins. */
  savings: Partial<Record<GroupKey, number>>;
}

/**
 * The fit rule (sidebar spec §4.2): which open groups to fold, in fold order,
 * so the panel stops overflowing. The shell runs it after every open, route
 * change and resize, then folds the result and announces each fold politely.
 *
 * Candidates are the open groups except `top` (it has no header, so it cannot
 * fold), the group just opened, the current page's group and any group holding
 * a T2 ₪ badge (כסף never folds while it carries ₪). `admin` is a candidate.
 * The least recently opened folds first; on a tie the group later in
 * `GROUP_ORDER` goes first, so the job order's head survives longest. Groups
 * are taken until their savings cover the overflow, less 1 px: an overflow of
 * ≤ 1 px is sub-pixel rounding, not a real overflow, so it folds nothing. When
 * even every candidate is not enough, all of them fold and the scroll region
 * takes the rest. Missing or non-finite numbers count as 0; negative savings
 * never offset another group's.
 */
export function planFolds(i: FoldInput): GroupKey[] {
  if (!(i.overflow > 1)) return [];
  const seq = (g: GroupKey): number => finiteOrZero(i.openedAt[g]);
  const rank = (g: GroupKey): number => GROUP_ORDER.indexOf(g);
  const candidates = [...new Set(i.open)].filter(
    (g) => g !== 'top' && g !== i.justOpened && g !== i.here && !i.holdsT2.includes(g),
  );
  candidates.sort((a, b) => seq(a) - seq(b) || rank(b) - rank(a));
  const folds: GroupKey[] = [];
  let saved = 0;
  for (const g of candidates) {
    if (saved >= i.overflow - 1) break;
    folds.push(g);
    saved += Math.max(0, finiteOrZero(i.savings[g]));
  }
  return folds;
}

function finiteOrZero(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
