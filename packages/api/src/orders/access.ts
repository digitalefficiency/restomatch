import type { Session } from '../context';
import { managerProcedure } from '../trpc';

/**
 * Orders role tiers (W2-06, deep-fix class 13).
 *
 * Interim until G-07's capabilities merge: the brief says to build the order
 * writes at manager tier first and leave the chef path behind G-07's
 * `order.draft`/`order.send` caps. Train A (W1-11) moves the existing writes to
 * `chefProcedure`; when it (or G-07) is on this branch's base, the swap is
 * this ONE line: `orderWriteProcedure = chefProcedure` (or `capProcedure('order.draft')`).
 */
export const orderWriteProcedure = managerProcedure;
/** The roles {@link orderWriteProcedure} admits — the role-matrix test reads this. */
export const ORDER_WRITE_ROLES: ReadonlyArray<Session['role']> = ['owner', 'manager'];

/**
 * Who sees ₪ on the orders screens [owner 31.10]: owner, manager, chef and the
 * read-only bookkeeper. The receiver never does (decision 6). Swap for G-07's
 * `can(role, 'price.view')` scoped to `orders.*` in one line.
 */
export function canSeeOrderPrices(role: Session['role'] | undefined | null): boolean {
  return role === 'owner' || role === 'manager' || role === 'chef' || role === 'bookkeeper';
}

/** Keys that carry purchase ₪ in an orders payload (the attack suite's deep scan). */
export const PRICE_KEY = /^(unitPrice.*|total.*|.*Ils|.*Agorot|lastTotal|priceSource|listPrice|contractPrice)$/;

/**
 * Deep-strip every ₪ key from an orders payload for a role without price
 * visibility. Server-side, so the receiver's tRPC JSON carries no ₪ (not just
 * a hidden column). Dates and plain objects are kept; arrays are mapped.
 */
export function redactOrderPrices<T>(value: T): T {
  return strip(value) as T;
}

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== 'object' || v instanceof Date) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (PRICE_KEY.test(k)) continue;
    out[k] = strip(x);
  }
  return out;
}

/** Redact unless the role may see order prices. */
export function forRole<T>(role: Session['role'] | undefined | null, value: T): T {
  return canSeeOrderPrices(role) ? value : redactOrderPrices(value);
}
