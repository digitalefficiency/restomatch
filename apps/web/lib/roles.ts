import type { UserRole } from '@restomatch/db';
import type { Locale } from './i18n/config';
import { generateRouteRoles } from './nav/registry';

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
 * Which roles may see each dashboard route — generated from the nav registry
 * (lib/nav/routes/*.ts, one file per route folder), so the nav, the middleware
 * gate and the per-page guards never drift apart. A `receiver` (shift manager)
 * gets the overview, receiving and other no-₪ screens — never a supplier
 * ledger or invoice page (owner decision: the receiver sees no ₪). Exact path → roles;
 * sub-paths inherit by longest prefix (`allowedRolesForPath`).
 */
export const ROUTE_ROLES: Record<string, UserRole[]> = generateRouteRoles();

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
