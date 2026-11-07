import type { UserRole } from '@restomatch/db';

/* Import-free (types only) so `nav/registry.ts` can union it without an import cycle
 * (roleLens → roles → registry). */

/**
 * I3: the 10 screens blocked to the bookkeeper on main (7.11) that she now READS:
 * הזמנות, קבלה, ספקים, קטלוג, מוצרים, מתכונים, מלאי, צוות, דוח חודשי, תקציר.
 * Sub-paths inherit (`/dashboard/orders/<id>`). `/dashboard/suppliers/ledger` already
 * allows her and keeps its own (edit) gate.
 */
export const BOOKKEEPER_READ_ONLY_ROUTES = [
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
] as const;

/** Path → roles that open it read-only. The registry unions these into ROUTE_ROLES (orchestrator line). */
export const READ_ONLY_ROUTES: Readonly<Record<string, readonly UserRole[]>> = Object.fromEntries(
  BOOKKEEPER_READ_ONLY_ROUTES.map((p) => [p, ['bookkeeper'] as const]),
);

