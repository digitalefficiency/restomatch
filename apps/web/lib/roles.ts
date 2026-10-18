import type { UserRole } from '@restomatch/db';
import type { Locale } from './i18n/config';

/**
 * Single source of truth for tenant-role display + dashboard visibility.
 * The nav filter, per-page server guards, the team screen, and the dashboard
 * header all read from here so they never drift apart.
 */

export const ALL_ROLES: UserRole[] = ['owner', 'manager', 'receiver', 'bookkeeper', 'chef'];

/** Hebrew display labels for tenant roles. */
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'בעלים',
  manager: 'מנהל/ת',
  receiver: 'מקבל סחורה',
  bookkeeper: 'חשב/ת',
  chef: 'שף',
};

/** English display labels for tenant roles. */
export const ROLE_LABELS_EN: Record<UserRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  receiver: 'Receiver',
  bookkeeper: 'Bookkeeper',
  chef: 'Chef',
};

export function roleLabels(locale: Locale = 'he'): Record<UserRole, string> {
  return locale === 'en' ? ROLE_LABELS_EN : ROLE_LABELS;
}

export function labelForRole(role: string, locale: Locale = 'he'): string {
  return roleLabels(locale)[role as UserRole] ?? role;
}

/**
 * Which roles may see each dashboard route. A `receiver` (shift manager) sees
 * only the overview + receiving inbox — least privilege. Drives both the nav
 * filter and the per-page server guards.
 */
export const ROUTE_ROLES: Record<string, UserRole[]> = {
  '/dashboard': ALL_ROLES,
  '/dashboard/receiving': ['owner', 'manager', 'receiver'],
  // Bookkeeper included: duplicate invoices are routed to them (approvals engine),
  // and approvals.approve/reject/escalate accept bookkeeper-routed items.
  '/dashboard/approvals': ['owner', 'manager', 'bookkeeper'],
  // S13 invoice inbox (WhatsApp / e-mail ingestion): managers act, bookkeepers read.
  '/dashboard/inbox': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/leaks': ['owner', 'manager', 'bookkeeper'],
  // Wave 1 (S12): ₪-back tracker = finance roles (like leaks); the monthly report = owner/manager.
  '/dashboard/recovery': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/reports': ['owner', 'manager'],
  // Exact entry too: nav visibility (canSeeRoute) is an exact-path lookup.
  '/dashboard/reports/monthly': ['owner', 'manager'],
  // AI assistant (S14, flag aiAssistant): owner + manager only.
  '/dashboard/ask': ['owner', 'manager'],
  '/dashboard/suppliers': ['owner', 'manager'],
  '/dashboard/catalog': ['owner', 'manager'],
  // Product pages are part of the catalog (names grid, price history, cheapest
  // supplier); without this rule every role could open them by URL.
  '/dashboard/products': ['owner', 'manager'],
  '/dashboard/orders': ['owner', 'manager'],
  // Wave-1 contracts + price alerts: finance tier, same as the contracts/priceAlerts
  // routers (financeProcedure). The nav entry is additionally feature-flag gated.
  '/dashboard/contracts': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/exports': ['owner', 'bookkeeper'],
  // Team: owners manage the roster; managers see it read-only and may set a
  // member's app language (e.g. an English-speaking receiver).
  '/dashboard/team': ['owner', 'manager'],
  // Settings holds PERSONAL security (password, 2FA, language, DSR) for every
  // role; the restaurant sections inside are owner-edit / manager+bookkeeper
  // read-only / hidden for receiver + chef (see app/dashboard/settings/page.tsx).
  '/dashboard/settings': ALL_ROLES,
  // Chain (S8): owner-level money across branches + branch management. The
  // chain router re-checks owner membership in the DB per request.
  '/dashboard/chain': ['owner'],
  '/dashboard/branches': ['owner'],
};

/** Whether `role` may see `href` (exact match). Unknown routes default to visible. */
export function canSeeRoute(role: UserRole, href: string): boolean {
  const allowed = ROUTE_ROLES[href];
  return allowed ? allowed.includes(role) : true;
}

/**
 * Roles allowed on a full pathname, by longest-prefix match against ROUTE_ROLES
 * (so `/dashboard/receiving/<id>` inherits `/dashboard/receiving`). Returns null
 * when no rule applies. Used by middleware for server-side route gating.
 */
export function allowedRolesForPath(path: string): UserRole[] | null {
  let best: { key: string; roles: UserRole[] } | null = null;
  for (const [key, roles] of Object.entries(ROUTE_ROLES)) {
    if (path === key || path.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, roles };
    }
  }
  return best ? best.roles : null;
}
