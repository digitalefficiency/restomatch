import type { UserRole } from '@restomatch/db';
import { allowedRolesForPath } from '@/lib/roles';
import { safeRelativePath } from '@/lib/safeRedirect';

/**
 * Forbidden-route helpers shared by the middleware (edge-safe: pure, no I/O)
 * and `/dashboard/forbidden` (ia-nav-07; lens-ia-nav §10.1).
 */

export const FORBIDDEN_PATH = '/dashboard/forbidden';

/**
 * The rewrite target when `role` may not open `path`, else null. The original
 * path + query ride along in `from` so the page can name the screen and offer
 * "open it in <branch>".
 */
export function forbiddenRewrite(path: string, search: string, role: UserRole): string | null {
  if (!path.startsWith('/dashboard') || path === FORBIDDEN_PATH) return null;
  const allowed = allowedRolesForPath(path);
  if (!allowed || allowed.includes(role)) return null;
  return `${FORBIDDEN_PATH}?${new URLSearchParams({ from: `${path}${search}` }).toString()}`;
}

/** The `from` a forbidden page may link back to: a same-origin /dashboard path, else null. */
export function forbiddenFrom(raw: unknown): string | null {
  const safe = safeRelativePath(raw, '');
  if (!safe) return null;
  const path = safe.split(/[?#]/)[0] ?? '';
  return path === '/dashboard' || path.startsWith('/dashboard/') ? safe : null;
}

/**
 * Message key (under `shell.screens`) naming the screen at `path`, by longest
 * prefix — `/dashboard/approvals/pay-run/x` → `payRun`, `/dashboard/leaks/claims` → `leaks`.
 */
const SCREENS: ReadonlyArray<readonly [string, ScreenKey]> = [
  ['/dashboard', 'home'],
  ['/dashboard/receiving', 'receiving'],
  ['/dashboard/approvals', 'approvals'],
  ['/dashboard/approvals/pay-run', 'payRun'],
  ['/dashboard/inbox', 'inbox'],
  ['/dashboard/invoices', 'invoices'],
  ['/dashboard/leaks', 'leaks'],
  ['/dashboard/leaks/claims', 'claims'],
  ['/dashboard/leaks/proof', 'leakProof'],
  ['/dashboard/leaks/report', 'leakReport'],
  ['/dashboard/recovery', 'recovery'],
  ['/dashboard/reports', 'reports'],
  ['/dashboard/reports/monthly', 'monthlyReport'],
  ['/dashboard/reports/digest', 'monthlyReport'],
  ['/dashboard/ask', 'ask'],
  ['/dashboard/suppliers', 'suppliers'],
  ['/dashboard/suppliers/ledger', 'ledger'],
  ['/dashboard/catalog', 'catalog'],
  ['/dashboard/products', 'catalog'],
  ['/dashboard/orders', 'orders'],
  ['/dashboard/contracts', 'contracts'],
  ['/dashboard/recipes', 'recipes'],
  ['/dashboard/inventory', 'inventory'],
  ['/dashboard/exports', 'exports'],
  ['/dashboard/integrations', 'integrations'],
  ['/dashboard/team', 'team'],
  ['/dashboard/settings', 'settings'],
  ['/dashboard/chain', 'chain'],
  ['/dashboard/branches', 'branches'],
];

export type ScreenKey =
  | 'home'
  | 'receiving'
  | 'approvals'
  | 'payRun'
  | 'inbox'
  | 'invoices'
  | 'leaks'
  | 'claims'
  | 'leakProof'
  | 'leakReport'
  | 'recovery'
  | 'reports'
  | 'monthlyReport'
  | 'ask'
  | 'suppliers'
  | 'ledger'
  | 'catalog'
  | 'orders'
  | 'contracts'
  | 'recipes'
  | 'inventory'
  | 'exports'
  | 'integrations'
  | 'team'
  | 'settings'
  | 'chain'
  | 'branches';

export function screenKeyForPath(path: string): ScreenKey {
  let best: readonly [string, ScreenKey] = SCREENS[0]!;
  for (const entry of SCREENS) {
    const [key] = entry;
    if ((path === key || path.startsWith(`${key}/`)) && key.length > best[0].length) best = entry;
  }
  return best[1];
}
