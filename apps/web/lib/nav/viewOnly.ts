import type { UserRole } from '@restomatch/db';

/**
 * 👁 view-only rows (sidebar SPEC §4.1 notes, §5.1, §6): a role that can open
 * a screen but cannot change anything on it gets the 16 px `Eye` on the badge
 * axis and the SR text ", צפייה בלבד". The eye is a promise about the SERVER,
 * so a key is listed only when (1) the role passes the route gate (registry
 * `roles`, enforced by the middleware through lib/roles.ts
 * `allowedRolesForPath`) AND (2) every write the screen makes is refused for
 * that role by its tRPC procedure tier. A UI that merely hides a button does
 * not count.
 *
 * Evidence (verified 14.11.2026; tiers in packages/api/src/trpc.ts:
 * managerProcedure :176 = owner|manager, chefProcedure :179 = owner|manager|chef):
 *
 * suppliers: route lib/nav/routes/suppliers.ts admits the bookkeeper. Writes,
 *   all managerProcedure (packages/api/src/routers/…):
 *   - list (manager.tsx): suppliers.create suppliers.ts:243, suppliers.setActive suppliers.ts:318
 *   - detail details/schedule tabs: suppliers.update suppliers.ts:267
 *   - detail contract tab (contracts-panel.tsx, contract-form.tsx): contracts.create contracts.ts:208,
 *     contracts.update :253, contracts.delete :295, contracts.lockCurrentPrices :426
 *   - detail catalog tab (catalog/browser.tsx): catalog.setItemActive catalog.ts:533,
 *     catalog.createItem catalog.ts:556, catalog.updateItem catalog.ts:607,
 *     catalog.deleteItem catalog.ts:718, products.update products.ts:129
 *   (suppliers.reconcileStatement suppliers.ts:217 is financeProcedure, but it writes
 *   nothing and lives on /dashboard/suppliers/ledger: the `ledger` row, where the
 *   bookkeeper edits — no eye there.)
 * contracts: route lib/nav/routes/contracts.ts admits the bookkeeper (reads are
 *   financeProcedure). Writes, all managerProcedure: contracts.create contracts.ts:208,
 *   contracts.update :253, contracts.delete :295, contracts.importPreview :308,
 *   contracts.importCommit :324, contracts.importDiff :364, contracts.lockCurrentPrices :426,
 *   contracts.adoptPrice :452; priceAlerts.dismiss priceAlerts.ts:59, priceAlerts.reopen :84,
 *   priceAlerts.refresh :132, priceAlerts.setThreshold :172, priceAlerts.deleteThreshold :215.
 * inventory: route lib/nav/routes/inventory.ts admits the bookkeeper (reads are
 *   inventoryReaderProcedure; count/page.tsx sends her back to the read-only home).
 *   Writes: inventoryProcedure = chefProcedure (inventory.ts:41): inventory.start :457,
 *   inventory.saveLines :490, inventory.setMeta :554, inventory.submitForClose :617,
 *   inventory.complete :659, inventory.amendLine :738 (owner only inside),
 *   inventory.discard :803; inventoryCloserProcedure (owner|manager, :62):
 *   inventory.setSales :587.
 *
 * Marked 👁 for the bookkeeper in the spec but LEFT OUT, because the route gate
 * does not admit her (the middleware rewrites her to /dashboard/forbidden, so
 * there is no row to carry an eye):
 * - orders: lib/nav/routes/orders.ts roles owner|manager|chef (writes there are
 *   chefProcedure / managerProcedure, so it qualifies the day the route admits her).
 * - receiving: lib/nav/routes/receiving.ts roles owner|manager|receiver.
 * - catalog: lib/nav/routes/catalog.ts roles owner|manager.
 * - recipes: lib/nav/routes/recipes.ts roles owner|manager|chef.
 * - team: lib/nav/routes/team.ts roles owner|manager.
 * __tests__/viewOnly.test.ts re-checks both halves: every listed role passes
 * the route gate, and every mutation the listed screens call sits on a tier
 * that excludes that role (appRouter metadata).
 */
export const VIEW_ONLY: Readonly<Partial<Record<string, readonly UserRole[]>>> = {
  suppliers: ['bookkeeper'],
  contracts: ['bookkeeper'],
  inventory: ['bookkeeper'],
};

/**
 * Whether `role` sees registry item `key` read-only. Own keys only, so an
 * unknown key (or one shaped like an Object.prototype member) is simply false.
 */
export function isViewOnly(role: UserRole, key: string): boolean {
  if (!Object.hasOwn(VIEW_ONLY, key)) return false;
  return VIEW_ONLY[key]?.includes(role) ?? false;
}
