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

/**
 * Of the 10, the screens whose server reads do NOT admit the bookkeeper yet (lab 7.11:
 * recipes / monthly / digest answer 500, inventory renders error cards; team.list is a
 * manager procedure). They stay 403 for her until the owner ships a SEPARATE read-only
 * procedure (reads and writes share one procedure there today): recipes + inventory →
 * W3-02, team → W3-07b, monthly + digest → W3-08. Each owner deletes its line here.
 */
export const I3_PENDING_SERVER_READ: readonly string[] = [
  '/dashboard/recipes',
  '/dashboard/inventory',
  '/dashboard/team',
  '/dashboard/reports/monthly',
  '/dashboard/reports/digest',
];

/** The I3 screens open read-only today (the server already admits her reads, never her writes). */
export const I3_READY = BOOKKEEPER_READ_ONLY_ROUTES.filter((p) => !I3_PENDING_SERVER_READ.includes(p));

/** Path → roles that open it read-only. The registry unions these into ROUTE_ROLES (orchestrator line). */
export const READ_ONLY_ROUTES: Readonly<Record<string, readonly UserRole[]>> = Object.fromEntries(
  I3_READY.map((p) => [p, ['bookkeeper'] as const]),
);

