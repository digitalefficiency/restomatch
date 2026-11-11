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

/**
 * Of the 10, the screens whose PAGE has no read-only mode yet, so opening them would hand the
 * bookkeeper a write surface (warden review 11.11): `/dashboard/receiving/[poId]` renders the
 * full ReceivingWizard, and its photo step calls `scans.upload` (a plain member procedure)
 * before any receiver-only call refuses her. Stays 403 until the wizard renders read-only for
 * `routeAccess(role, path) === 'read'` (W3-03 owns `dash/receiving/**`).
 */
export const I3_PENDING_UI: readonly string[] = ['/dashboard/receiving'];

/** The I3 screens open read-only today (the server already admits her reads, never her writes). */
export const I3_READY = BOOKKEEPER_READ_ONLY_ROUTES.filter(
  (p) => !I3_PENDING_SERVER_READ.includes(p) && !I3_PENDING_UI.includes(p),
);

/**
 * Pure write pages under an I3_READY screen that stay closed to the bookkeeper (they would
 * otherwise inherit her read gate by prefix): the new-order wizard and the catalog import.
 * `applyReadOnly` gives each an explicit gate = its inherited roles minus the bookkeeper.
 */
export const I3_WRITE_ONLY_SUBPATHS: readonly string[] = ['/dashboard/orders/new', '/dashboard/catalog/import'];

/** Path → roles that open it read-only. The registry unions these into ROUTE_ROLES (orchestrator line). */
export const READ_ONLY_ROUTES: Readonly<Record<string, readonly UserRole[]>> = Object.fromEntries(
  I3_READY.map((p) => [p, ['bookkeeper'] as const]),
);

function inherited(gates: Record<string, UserRole[]>, path: string): UserRole[] | null {
  let best: string | null = null;
  for (const key of Object.keys(gates)) {
    if ((path === key || path.startsWith(`${key}/`)) && (!best || key.length > best.length)) best = key;
  }
  return best ? gates[best]! : null;
}

/**
 * The registry's one IA-03 line: add the read-only roles to their screens' gates, then pin the
 * write-only sub-paths to their pre-I3 roles (never the bookkeeper). Mutates and returns `gates`.
 */
export function applyReadOnly(gates: Record<string, UserRole[]>): Record<string, UserRole[]> {
  const pinned = I3_WRITE_ONLY_SUBPATHS.map((p) => [p, inherited(gates, p)] as const);
  for (const [p, rs] of Object.entries(READ_ONLY_ROUTES)) gates[p] = [...new Set([...(gates[p] ?? []), ...rs])];
  for (const [p, before] of pinned) {
    // The pre-I3 inherited roles, captured before the union: the bookkeeper is never added here.
    if (before) gates[p] = [...before];
  }
  return gates;
}
