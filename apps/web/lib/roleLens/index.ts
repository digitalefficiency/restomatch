import type { UserRole } from '@restomatch/db';
import type { Locale } from '../i18n/config';
import { ALL_ROLES, ROUTE_ROLES } from '../roles';
import { READ_ONLY_ROUTES } from './readOnly';

export { BOOKKEEPER_READ_ONLY_ROUTES, I3_PENDING_SERVER_READ, I3_READY, READ_ONLY_ROUTES } from './readOnly';

/**
 * IA-03 — visible role lenses (IA-SPEC rule 3, §6.1; owner decision I3, 7.11).
 *
 * ONE table answers "what does role X see on screen Y": the nav (via the registry line
 * that unions `READ_ONLY_ROUTES`), the 403 page's next step, the team screen's "מה
 * התפקיד רואה" row and drill links ("no link to a screen the viewer cannot open").
 * Pure data, edge-safe (lib/roles.ts and the middleware import the registry).
 *
 * Interim source: the owner decisions (README §7, 31.10, I3) and `ROUTE_ROLES` on main.
 * When G-07's `CAP` lands, `ROLE_LENS.money` is derived from `money.view` /
 * `order.money.view` / `recipe.money.view` and a test pins lens ⇔ CAP. The server ₪
 * strip is H-11ʰ (human PR); this module never redacts anything itself.
 */

/** Where a role sees ₪: everywhere, only on orders + recipes (chef), or nowhere (receiver). */
export type MoneyLens = 'all' | 'orders+recipes' | 'none';

/** What kind of data a screen is about — decides whether a role could EVER open it. */
export type ScreenClass = 'home' | 'money' | 'orders' | 'recipes' | 'quantities' | 'admin' | 'owner-only';

export interface RoleLens {
  money: MoneyLens;
  /** Sees quantities (ordered / received / counted). */
  quantities: boolean;
  /** Reads every screen of the restaurant (bookkeeper, I3) even where she does not edit. */
  readsAll: boolean;
  /** Screen classes this role changes things on. */
  edits: readonly ScreenClass[];
}

export const ROLE_LENS: Readonly<Record<UserRole, RoleLens>> = {
  owner: { money: 'all', quantities: true, readsAll: true, edits: ['home', 'money', 'orders', 'recipes', 'quantities', 'admin', 'owner-only'] },
  manager: { money: 'all', quantities: true, readsAll: false, edits: ['home', 'money', 'orders', 'recipes', 'quantities', 'admin'] },
  // I3: reads everything; edits the money screens and the account cards (M8), never orders or counts.
  bookkeeper: { money: 'all', quantities: true, readsAll: true, edits: ['home', 'money'] },
  // The chef orders directly (31.10) and sees ₪ only on orders and recipes.
  chef: { money: 'orders+recipes', quantities: true, readsAll: false, edits: ['home', 'orders', 'recipes', 'quantities'] },
  // The receiver sees no ₪ anywhere.
  receiver: { money: 'none', quantities: true, readsAll: false, edits: ['home', 'quantities'] },
};

/** Top-level dashboard segment → what the screen is about. Unknown segments: 'admin'. */
export const SCREEN_CLASS: Readonly<Record<string, ScreenClass>> = {
  '': 'home',
  home: 'home',
  approvals: 'money',
  inbox: 'money',
  invoices: 'money',
  leaks: 'money',
  recovery: 'money',
  suppliers: 'money',
  exports: 'money',
  reports: 'money',
  ask: 'money',
  contracts: 'money',
  catalog: 'money',
  products: 'money',
  orders: 'orders',
  recipes: 'recipes',
  receiving: 'quantities',
  inventory: 'quantities',
  team: 'admin',
  integrations: 'admin',
  // Personal settings (language, notifications) are every role's; admin tabs gate themselves.
  settings: 'home',
  chain: 'owner-only',
  branches: 'owner-only',
  // System pages.
  forbidden: 'home',
  go: 'home',
  lab: 'admin',
};

/**
 * Sub-paths whose class differs from their first segment (longest prefix wins).
 * `/dashboard/catalog/mapping` is the G-08 "זה אותו מוצר?" product question queue: the chef
 * answers it in a no-₪ mode (mapper.tsx `chef`), so it is not a ₪ screen like the rest of catalog.
 */
export const SCREEN_CLASS_PATH: Readonly<Record<string, ScreenClass>> = {
  '/dashboard/catalog/mapping': 'quantities',
};

/** The class of a `/dashboard/...` path: a sub-path override, else its first segment. */
export function screenClassOf(path: string): ScreenClass {
  const clean = path.split(/[?#]/)[0] ?? path;
  let best: string | null = null;
  for (const key of Object.keys(SCREEN_CLASS_PATH)) {
    if ((clean === key || clean.startsWith(`${key}/`)) && (!best || key.length > best.length)) best = key;
  }
  if (best) return SCREEN_CLASS_PATH[best]!;
  const seg = clean.replace(/^\/dashboard\/?/, '').split('/')[0] ?? '';
  return SCREEN_CLASS[seg] ?? 'admin';
}

/** Longest-prefix match of `path` against `READ_ONLY_ROUTES` (exact or `${key}/…`). */
function longestMatch(path: string, table: Readonly<Record<string, readonly UserRole[]>>): { key: string; roles: readonly UserRole[] } | null {
  let best: { key: string; roles: readonly UserRole[] } | null = null;
  for (const [key, roles] of Object.entries(table)) {
    if ((path === key || path.startsWith(`${key}/`)) && (!best || key.length > best.key.length)) best = { key, roles };
  }
  return best;
}

/** A path with its query / hash removed. */
function pathOnly(href: string): string {
  return href.split(/[?#]/)[0] || '/dashboard';
}

export type Access = 'edit' | 'read' | 'none';

/**
 * What `role` may do on `path`: open it with its normal controls (`edit`), open it with
 * the write controls hidden (`read`), or not at all (`none`). `read` wins over the route
 * gate, so it stays correct before AND after the registry union line lands.
 */
export function routeAccess(role: UserRole, href: string): Access {
  return accessFrom(role, href, ROUTE_ROLES, READ_ONLY_ROUTES);
}

/** `routeAccess` over explicit tables (exported for tests). */
export function accessFrom(
  role: UserRole,
  href: string,
  gates: Readonly<Record<string, readonly UserRole[]>>,
  readOnly: Readonly<Record<string, readonly UserRole[]>>,
): Access {
  const path = pathOnly(href);
  // Fail closed: a screen class the role can never get is `none`, whatever the gate says
  // (unknown segments such as `/dashboard/lab` fall back to the all-roles home gate).
  if (!canEverOpen(role, path)) return 'none';
  const gate = longestMatch(path, gates);
  const ro = longestMatch(path, readOnly);
  // A deeper route gate decides alone (it may be stricter, or already let the role in).
  if (ro?.roles.includes(role) && (!gate || gate.key.length <= ro.key.length)) return 'read';
  return !gate || gate.roles.includes(role) ? 'edit' : 'none';
}

/** "No link to a screen the viewer cannot open" (IA-SPEC §6.1 IA-03 d). */
export function linkableFor(role: UserRole, href: string): boolean {
  return routeAccess(role, href) !== 'none';
}

/**
 * Could ANY lens decision give `role` this screen? False for ₪ screens for the receiver
 * and the chef, and for owner-only screens below the owner. The 403 page offers "בקשו
 * גישה" only when this is true; otherwise only the role's own next step (rule 3).
 */
export function canEverOpen(role: UserRole, href: string): boolean {
  const lens = ROLE_LENS[role];
  switch (screenClassOf(pathOnly(href))) {
    case 'home':
    case 'quantities':
      return true;
    case 'money':
      return lens.money === 'all';
    case 'orders':
    case 'recipes':
      return lens.money !== 'none';
    case 'admin':
      return role === 'owner' || role === 'manager' || role === 'bookkeeper';
    case 'owner-only':
      return role === 'owner';
  }
}

export interface NextStep {
  href: string;
  /** i18n-free label (the 403 page may wrap it in its own namespace). */
  label: Record<Locale, string>;
}

/** Each role's own next step: where its daily work starts (IA-SPEC §5). */
export const NEXT_STEP: Readonly<Record<UserRole, NextStep>> = {
  owner: { href: '/dashboard', label: { he: 'לדף הבית', en: 'Go to home' } },
  manager: { href: '/dashboard/approvals', label: { he: 'לאישורים', en: 'Go to approvals' } },
  bookkeeper: { href: '/dashboard/invoices', label: { he: 'לחשבוניות', en: 'Go to invoices' } },
  chef: { href: '/dashboard/orders', label: { he: 'להזמנות', en: 'Go to orders' } },
  receiver: { href: '/dashboard/receiving', label: { he: 'לקבלת סחורה', en: 'Go to receiving' } },
};

export interface ForbiddenModel {
  nextStep: NextStep;
  /** Offer the prefilled access request ("בקשו גישה")? */
  offerAccessRequest: boolean;
}

/**
 * The 403 page model for `role` on `from`: always the role's own next step (never the
 * screen it was refused), and an access request only for a screen the role could get.
 * If the next step is itself not open to the role, fall back to the home.
 */
export function forbiddenModelFor(role: UserRole, from: string): ForbiddenModel {
  const own = NEXT_STEP[role];
  const step = linkableFor(role, own.href) && pathOnly(own.href) !== pathOnly(from) ? own : NEXT_STEP.owner;
  return { nextStep: step, offerAccessRequest: canEverOpen(role, from) };
}

/** One "מה התפקיד רואה" row for the team screen (IA-03 a). */
export interface LensRow {
  role: UserRole;
  money: string;
  quantities: string;
  reads: string;
  edits: string;
}

const COPY: Record<Locale, { money: Record<MoneyLens, string>; yes: string; no: string; readsAll: string; readsOwn: string; edits: Record<ScreenClass, string> }> = {
  he: {
    money: { all: 'רואה ₪', 'orders+recipes': '₪ רק בהזמנות ובמתכונים', none: 'בלי ₪' },
    yes: 'רואה כמויות',
    no: 'בלי כמויות',
    readsAll: 'קורא את כל המסכים',
    readsOwn: 'קורא את מסכי התפקיד',
    edits: { home: 'בית', money: 'כסף', orders: 'הזמנות', recipes: 'מתכונים', quantities: 'קבלה וספירה', admin: 'ניהול', 'owner-only': 'רשת' },
  },
  en: {
    money: { all: 'Sees ₪', 'orders+recipes': '₪ on orders and recipes only', none: 'No ₪' },
    yes: 'Sees quantities',
    no: 'No quantities',
    readsAll: 'Reads every screen',
    readsOwn: "Reads the role's screens",
    edits: { home: 'Home', money: 'Money', orders: 'Orders', recipes: 'Recipes', quantities: 'Receiving and counts', admin: 'Admin', 'owner-only': 'Chain' },
  },
};

export function lensRows(locale: Locale = 'he'): LensRow[] {
  const c = COPY[locale];
  return ALL_ROLES.map((role) => {
    const l = ROLE_LENS[role];
    return {
      role,
      money: c.money[l.money],
      quantities: l.quantities ? c.yes : c.no,
      reads: l.readsAll ? c.readsAll : c.readsOwn,
      edits: l.edits.filter((e) => e !== 'home').map((e) => c.edits[e]).join(' · '),
    };
  });
}
