import type { UserRole } from '@restomatch/db';
import { allowedRolesForPath } from '@/lib/roles';

/**
 * Where to land after a branch switch (ia-nav-08, exec-desktop-23; lens-ia-nav §8).
 *
 * - A list or hub keeps its path plus the NON-entity filters (period, compare,
 *   severity, type, status). Entity filters (`sup`, `cat`, `sel`, ids…) are
 *   per-tenant, so they are dropped.
 * - A detail route (`/orders/<poId>`) falls back to its parent list: the id
 *   belongs to the branch being left.
 * - A route the target role can't open lands on that branch's home.
 *
 * Pure: unit tested, used by BranchSwitcher. Until the W1-03 nav registry
 * lands, the detail → parent table lives here.
 */

/** Filters that mean the same thing in every branch. Everything else is dropped. */
export const KEPT_PARAMS = ['p', 'from', 'to', 'cmp', 'sev', 'type', 'st'] as const;

/** `[id]` segments: first static segment(s) → the parent list to fall back to. */
const DETAIL_PARENTS: ReadonlyArray<{ base: string; static: readonly string[]; parent: string }> = [
  { base: '/dashboard/orders', static: ['new', 'capture'], parent: '/dashboard/orders' },
  { base: '/dashboard/receiving', static: ['share'], parent: '/dashboard/receiving' },
  { base: '/dashboard/invoices', static: [], parent: '/dashboard/approvals' },
  { base: '/dashboard/suppliers', static: ['ledger'], parent: '/dashboard/suppliers' },
  { base: '/dashboard/products', static: [], parent: '/dashboard/catalog' },
  { base: '/dashboard/recipes', static: ['new'], parent: '/dashboard/recipes' },
  { base: '/dashboard/inventory', static: ['count'], parent: '/dashboard/inventory' },
];

export type BranchTargetReason = 'kept' | 'parent' | 'home';

export interface BranchTarget {
  /** Path + kept query, e.g. `/dashboard/approvals?sev=block`. */
  href: string;
  /** Why it is not simply the same page (drives the toast). */
  reason: BranchTargetReason;
  /** The path the user was on (for the toast's "why"). */
  fromPath: string;
}

/** The parent list of a detail path, or null when `path` is not a detail route. */
export function detailParent(path: string): string | null {
  for (const d of DETAIL_PARENTS) {
    if (!path.startsWith(`${d.base}/`)) continue;
    const seg = path.slice(d.base.length + 1).split('/')[0] ?? '';
    if (seg && !d.static.includes(seg)) return d.parent;
  }
  return null;
}

function keptQuery(search: string): string {
  const src = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const v = src.get(key);
    if (v !== null && v !== '') out.set(key, v);
  }
  const qs = out.toString();
  return qs ? `?${qs}` : '';
}

export function branchSafeTarget(pathname: string, search: string, targetRole: UserRole): BranchTarget {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/dashboard')) return { href: '/dashboard', reason: 'home', fromPath: path };
  const parent = detailParent(path);
  const candidate = parent ?? path;
  const allowed = allowedRolesForPath(candidate);
  if (allowed && !allowed.includes(targetRole)) return { href: '/dashboard', reason: 'home', fromPath: path };
  // A detail id belongs to the branch being left: its query (filters on the id) goes too.
  if (parent) return { href: parent, reason: 'parent', fromPath: path };
  return { href: `${path}${keptQuery(search)}`, reason: 'kept', fromPath: path };
}
