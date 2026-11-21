import type { UserRole } from '@restomatch/db';

/*
 * IA-03 · display-only read lens. This file DECIDES NO ACCESS: who may open a screen is the
 * route registry (lib/nav/routes/*.ts → ROUTE_ROLES), the one gate (Train C: converged on
 * W2-08 #251's mechanism, where each screen's route file lists the bookkeeper when owner
 * decision I3 opens it to her, with the documented exceptions in nav-registry.test.ts).
 *
 * This list only says: where the gate already admits the bookkeeper, she READS (no write
 * controls). `routeAccess(role, path) === 'read'` drives read-only UI (ReceivingWizard
 * `readOnly`, supplier tabs, …). A deeper route that lists her explicitly (the supplier
 * ledger, order capture) is hers to edit.
 */
export const BOOKKEEPER_READ_ONLY_ROUTES = [
  // Owner decision I3 (7.11): the 10 screens she reads but does not edit…
  '/dashboard/orders',
  '/dashboard/receiving',
  '/dashboard/suppliers',
  '/dashboard/catalog',
  '/dashboard/products',
  '/dashboard/recipes',
  '/dashboard/inventory',
  '/dashboard/team',
  '/dashboard/reports/monthly',
  '/dashboard/reports/digest',
  // …and W3-01 decision 7: the chain matrix (chain.matrix re-checks per branch).
  '/dashboard/chain/matrix',
] as const;

/** Path → roles that see it read-only (display lens; never a gate). */
export const READ_ONLY_ROUTES: Readonly<Record<string, readonly UserRole[]>> = Object.fromEntries(
  BOOKKEEPER_READ_ONLY_ROUTES.map((p) => [p, ['bookkeeper'] as const]),
);
