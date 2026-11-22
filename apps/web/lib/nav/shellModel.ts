import type { UserRole } from '@restomatch/db';
import { QUEUE_HREF, QUEUE_KEY, queueVisible } from './queue';
import type { GroupKey, NavViewer, RouteDef } from './types';
import { isViewOnly } from './viewOnly';
import { footerGroups, mainGroups, navGroups, type NavGroup } from './visibility';

/**
 * What the side menu renders for one viewer (sidebar SPEC §1, §4.1). Pure and
 * built ONLY on lib/nav/visibility.ts (navGroups / mainGroups / footerGroups),
 * so who-sees-what keeps a single source: the registry and the route gate.
 * This module only arranges the result into the shell's places (top items,
 * groups, footer, account menu) and adds the shell's own לטיפולי item.
 */

/** Rail / phone-bar short forms (`navShell` labels); `search` and `help` are the shell's own tiles. */
export type ShortLabel = 'home' | 'queue' | 'receiving' | 'contracts' | 'recipes' | 'inventory' | 'orders' | 'search' | 'help';

/** One menu row / rail tile: enough to link, place and mark it; labels and icons stay in the UI layer. */
export interface ShellItem {
  /** Registry key, or `queue` for לטיפולי. */
  key: string;
  href: string;
  /**
   * The viewer's nav group for it (after the single-branch move: branches → ניהול): the
   * group it renders in on the panel; on the flat rail (where every item sits in `top`)
   * the group it would belong to. לטיפולי is `top`.
   */
  group: GroupKey;
  /** 👁: the viewer can open it but the server refuses their writes (lib/nav/viewOnly.ts). */
  viewOnly: boolean;
  /** Short label under a rail icon, when the full label does not fit. */
  short?: ShortLabel;
}

/** A collapsible group (panel) / group tile with a flyout (rail). */
export interface ShellGroup {
  group: GroupKey;
  items: ShellItem[];
}

/** The whole side menu for one viewer, by place. */
export interface ShellModel {
  /** Chef and receiver: one flat, labelled rail (≤ 5 destinations), no panel and no groups (§1.4). */
  flat: boolean;
  /** Ungrouped rows above the groups: בית, לטיפולי (flat: every destination). */
  top: ShellItem[];
  /** Main-list groups in job order (never `top`, never a footer group). */
  groups: ShellGroup[];
  /** Pinned footer groups (ניהול). */
  footer: ShellGroup[];
  /** Items that live in the account menu instead of the list (flat: הגדרות). */
  account: ShellItem[];
}

const FLAT_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['chef', 'receiver']);
const HOME_KEY = 'home';
const SETTINGS_KEY = 'settings';

/** The rail words of §1.2 (קבלה · חוזים · מנות · ספירה …), the same as the phone bar's. */
const SHORT: ReadonlyMap<string, ShortLabel> = new Map<string, ShortLabel>([
  ['home', 'home'],
  [QUEUE_KEY, 'queue'],
  ['receiving', 'receiving'],
  ['contracts', 'contracts'],
  ['recipes', 'recipes'],
  ['inventory', 'inventory'],
  ['orders', 'orders'],
]);

/**
 * Rows in the order of the master table (SPEC §4.1). The registry's own order is
 * kept for anything the table does not list, placed by its nearest relative:
 * the invoices register after חשבוניות נכנסות, מעקב זיכויים after דרישות זיכוי,
 * סגירת חודש right before ייצוא (the table merges them as "סגירת חודש וייצוא").
 */
const SPEC_ORDER: readonly string[] = [
  'home',
  QUEUE_KEY,
  'approvals',
  'inbox',
  'invoices',
  'payRun',
  'claims',
  'recovery',
  'ledger',
  'close',
  'exports',
  'leaks',
  'monthlyReport',
  'ask',
  'orders',
  'receiving',
  'suppliers',
  'catalog',
  'contracts',
  'recipes',
  'inventory',
  'chain',
  // `team` before `branches`: in רשת only branches meets chain (chain, branches as in the
  // table), and a single-branch owner, whose סניפים moves to ניהול (`groupWhenSingle`),
  // keeps the registry's ניהול order there (צוות first), which the table does not list.
  'team',
  'branches',
  'integrations',
  'settings',
];

/** Stable sort by SPEC_ORDER; keys it does not list keep their relative order after the listed ones. */
export function inSpecOrder<T extends { key: string }>(items: readonly T[]): T[] {
  const rank = (key: string, i: number) => {
    const at = SPEC_ORDER.indexOf(key);
    return at === -1 ? SPEC_ORDER.length + i : at;
  };
  return items
    .map((item, i) => ({ item, r: rank(item.key, i) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.item);
}

function shellItem(key: string, href: string, group: GroupKey, role: UserRole): ShellItem {
  const item: ShellItem = { key, href, group, viewOnly: isViewOnly(role, key) };
  const short = SHORT.get(key);
  if (short) item.short = short;
  return item;
}

function fromDef(def: RouteDef, group: GroupKey, role: UserRole): ShellItem {
  return shellItem(def.key, def.path, group, role);
}

function shellGroup(g: NavGroup, role: UserRole): ShellGroup {
  return { group: g.group, items: inSpecOrder(g.items.map((d) => fromDef(d, g.group, role))) };
}

/**
 * The side menu for `viewer`.
 *
 * - Owner, manager, bookkeeper: `top` = the `top` group's items (בית) with
 *   לטיפולי right after בית; `groups` = the main groups minus `top`;
 *   `footer` = the footer groups; `account` is empty (הגדרות sits in ניהול).
 * - Chef, receiver (`flat`): `top` = every visible item except הגדרות (בית
 *   first); הגדרות moves to `account`; no groups.
 *
 * Groups keep navGroups' job order; the rows inside a group (and the flat
 * rail's rows) follow the master table (`inSpecOrder`).
 */
export function shellModel(viewer: NavViewer): ShellModel {
  const { role } = viewer;

  if (FLAT_ROLES.has(role)) {
    const items = inSpecOrder(navGroups(viewer).flatMap((g) => g.items.map((d) => fromDef(d, g.group, role))));
    return {
      flat: true,
      top: items.filter((i) => i.key !== SETTINGS_KEY),
      groups: [],
      footer: [],
      account: items.filter((i) => i.key === SETTINGS_KEY),
    };
  }

  const main = mainGroups(viewer);
  const top = main.filter((g) => g.group === 'top').flatMap((g) => shellGroup(g, role).items);
  if (queueVisible(role)) {
    // Right after בית (§4.1); first if a viewer ever had no בית.
    top.splice(top.findIndex((i) => i.key === HOME_KEY) + 1, 0, shellItem(QUEUE_KEY, QUEUE_HREF, 'top', role));
  }
  return {
    flat: false,
    top,
    groups: main.filter((g) => g.group !== 'top').map((g) => shellGroup(g, role)),
    footer: footerGroups(viewer).map((g) => shellGroup(g, role)),
    account: [],
  };
}
