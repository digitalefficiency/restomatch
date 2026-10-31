import type { UserRole } from '@restomatch/db';

/**
 * The 25 forbidden role → route pairs (lens-ia-nav ia-nav-07 probe: every one
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
  // Owner decision: the receiver sees no ₪ — the invoice page shows prices, line totals and VAT ₪.
  ['receiver', '/dashboard/invoices/00000000-0000-4000-8000-000000000000'],
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
  // TODO(W2-06): the chef may draft orders (owner decision 25.10); `/dashboard/orders`
  // is deliberately NOT pinned either way until the role rule changes.
  ['chef', '/dashboard/team'],
  ['chef', '/dashboard/exports'],
];
