import type { UserRole } from '@restomatch/db';

/**
 * The 24 forbidden role → route pairs (lens-ia-nav ia-nav-07 probe: every one
 * used to bounce silently to /dashboard). Shared by the unit test (middleware
 * rule) and the W1-04 e2e spec (the real in-shell 403 page).
 */
export const FORBIDDEN_PAIRS: ReadonlyArray<readonly [UserRole, string]> = [
  ['manager', '/dashboard/exports'],
  ['manager', '/dashboard/chain'],
  ['manager', '/dashboard/branches'],
  ['receiver', '/dashboard/approvals'],
  ['receiver', '/dashboard/leaks'],
  ['receiver', '/dashboard/orders'],
  ['receiver', '/dashboard/catalog'],
  ['receiver', '/dashboard/exports'],
  ['receiver', '/dashboard/team'],
  ['receiver', '/dashboard/recipes'],
  ['bookkeeper', '/dashboard/orders'],
  ['bookkeeper', '/dashboard/receiving'],
  ['bookkeeper', '/dashboard/suppliers'],
  ['bookkeeper', '/dashboard/catalog'],
  ['bookkeeper', '/dashboard/team'],
  ['bookkeeper', '/dashboard/recipes'],
  ['bookkeeper', '/dashboard/chain'],
  ['chef', '/dashboard/approvals/pay-run'],
  ['chef', '/dashboard/approvals'],
  ['chef', '/dashboard/receiving'],
  ['chef', '/dashboard/leaks'],
  ['chef', '/dashboard/invoices/00000000-0000-4000-8000-000000000000'],
  ['chef', '/dashboard/orders'],
  ['chef', '/dashboard/exports'],
];
