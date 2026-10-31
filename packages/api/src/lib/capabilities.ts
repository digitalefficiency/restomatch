import type { UserRole } from '@restomatch/db';

/**
 * G-07 — the ONE server-side capability table. "Who may do / see X" lives here,
 * not in four drifting copies (router tiers, web ROUTE_ROLES, queue-summary,
 * nav). Procedures declare a capability with `can(cap)` (trpc.ts); resolvers
 * use `hasCap` / `canOn` / `redactPrices` for row- and field-level rules.
 *
 * Owner decisions encoded (README §7 + 31.10):
 *  - Receiver and chef see no purchase / leak ₪ (`money.view`).
 *  - The chef sees, creates, edits, sends and cancels the restaurant's orders
 *    with no manager approval. The chef's ₪ scopes are exactly: the ORDERS
 *    screens (`order.money.view`) and RECIPES — plate cost, menu price, margin
 *    (`recipe.money.view`). Everywhere else (inventory, leaks, approvals,
 *    invoices, claims, home, search, bell, badges) the chef sees no ₪.
 *  - The receiver sees no ₪ anywhere and gets no supplier ledger.
 *  - The bookkeeper reads everything and edits account cards (audited).
 *
 * The web cannot import @restomatch/api values in 'use client' files: read CAP
 * in a server component (createServerCaller page) and pass booleans down.
 */
export const CAP = {
  /** Purchase / leak ₪ anywhere outside the orders screens. */
  'money.view': ['owner', 'manager', 'bookkeeper'],
  /** Supplier / catalog unit prices outside the orders screens. */
  'price.view': ['owner', 'manager', 'bookkeeper'],
  'contract.view': ['owner', 'manager', 'bookkeeper'],
  /** Supplier ledger (balances, payments). No receiver (owner). */
  'ledger.view': ['owner', 'manager', 'bookkeeper'],

  /** Read the restaurant's orders (list + detail). */
  'order.view': ['owner', 'manager', 'bookkeeper', 'chef'],
  /** Prices + order totals ON THE ORDERS SCREENS ONLY (owner, 31.10 later). */
  'order.money.view': ['owner', 'manager', 'bookkeeper', 'chef'],
  /** Recipe ₪ — plate cost, menu price, margin (owner, 31.10 evening). */
  'recipe.money.view': ['owner', 'manager', 'bookkeeper', 'chef'],

  /** Create + edit an order (draft). */
  'order.draft': ['owner', 'manager', 'chef'],
  /** Send an order to the supplier — the chef orders directly, no approval. */
  'order.send': ['owner', 'manager', 'chef'],
  /** Cancel an order. */
  'order.cancel': ['owner', 'manager', 'chef'],

  'intake.approve': ['owner', 'manager', 'bookkeeper'],
  'invoice.correct': ['owner', 'manager', 'bookkeeper'],
  /** Gate only — WHICH items a role decides is `ACT_ON` (lib/roles.ts). */
  'discrepancy.decide': ['owner', 'manager', 'bookkeeper'],

  'receipt.count': ['owner', 'manager', 'receiver', 'chef'],
  /** Decision 21: a walk-in supplier is approved by the manager. */
  'receipt.confirm_walk_in': ['owner', 'manager'],

  /** Audited; the bookkeeper edits account cards (owner). */
  'accounting.edit': ['owner', 'bookkeeper'],
  'settings.edit': ['owner'],
  'team.manage': ['owner'],
} as const satisfies Record<string, ReadonlyArray<UserRole>>;

export type Cap = keyof typeof CAP;
export const CAPS = Object.keys(CAP) as Cap[];

export function hasCap(role: UserRole, cap: Cap): boolean {
  return (CAP[cap] as ReadonlyArray<UserRole>).includes(role);
}

/** Every capability a role holds (for a server component to pass booleans down). */
export function capsOf(role: UserRole): Cap[] {
  return CAPS.filter((cap) => hasCap(role, cap));
}

/** The slice of a tRPC member context these helpers need. */
export interface CapSubject {
  session: { role: UserRole; userId: string };
}

/**
 * Own-row rule: below manager, which roles may use a capability only on rows
 * they created. EMPTY for the order caps by the owner decision of 31.10 (later):
 * the chef works on ALL of the restaurant's orders "freely". Re-introducing the
 * draft-ownership rule is a one-line change here (e.g. `'order.draft': ['chef']`).
 */
export const OWN_ROWS_ONLY: Readonly<Partial<Record<Cap, ReadonlyArray<UserRole>>>> = {};

/**
 * Row-level capability check: `hasCap` plus the own-row rule for roles listed
 * in `OWN_ROWS_ONLY[cap]` (row must be `createdBy = me`). Tenant isolation is
 * NOT checked here — RLS + the resolver's restaurant filter own that.
 */
export function canOn(ctx: CapSubject, cap: Cap, row: { createdBy: string | null }): boolean {
  const { role, userId } = ctx.session;
  if (!hasCap(role, cap)) return false;
  if (OWN_ROWS_ONLY[cap]?.includes(role)) return row.createdBy === userId;
  return true;
}

/**
 * Where a ₪ figure is shown. `'orders'` = the orders screens (create / edit /
 * send / list / detail); `'recipes'` = recipe plate cost, menu price, margin;
 * `'general'` = anywhere else. H-11's server strip reads the same table.
 */
export type PriceScope = 'orders' | 'recipes' | 'general';

/** The capability that gates ₪ in each scope. */
export const MONEY_SCOPE_CAP: Readonly<Record<PriceScope, Cap>> = {
  orders: 'order.money.view',
  recipes: 'recipe.money.view',
  general: 'price.view',
};

export function canViewPrices(role: UserRole, scope: PriceScope = 'general'): boolean {
  return hasCap(role, MONEY_SCOPE_CAP[scope]);
}

/**
 * Null the listed price / ₪ fields of a row when the caller may not see prices
 * in `scope`. Returns the row unchanged (same reference) when allowed.
 *
 *   redactPrices(ctx, line, ['unitPrice', 'lineTotal'], 'orders')
 */
export function redactPrices<T extends Record<string, unknown>, K extends keyof T>(
  ctx: CapSubject,
  row: T,
  fields: ReadonlyArray<K>,
  scope: PriceScope = 'general',
): T | (Omit<T, K> & { [P in K]: null }) {
  if (canViewPrices(ctx.session.role, scope)) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) out[f as string] = null;
  return out as Omit<T, K> & { [P in K]: null };
}
