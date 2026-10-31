/**
 * The wizard's working order is never only in React state: every change is saved
 * on this device (one cart per supplier, so switching supplier keeps both), and the
 * server draft it becomes is tracked here too. localStorage can be missing, full or
 * blocked (private mode, previews) — every access is wrapped and the wizard simply
 * runs without it.
 */

export interface CartLine {
  key: string;
  productId?: string;
  rawDescription: string;
  nameEn?: string | null;
  qty: number;
  unit: string;
  unitPriceExpected?: number;
  /** Set by "order again": a price that is not the user's own (shown on review). */
  priceSource?: 'contract' | 'catalog' | 'last' | 'none';
}

/** A po_lines row as last read back from the server draft. */
export interface ServerLine {
  id: string;
  productId: string | null;
  rawDescription: string | null;
  qty: number;
  unit: string;
  unitPriceExpected: number | null;
}

export interface Cart {
  lines: CartLine[];
  deliveryDate: string;
  channel: 'email' | 'whatsapp' | 'none' | null;
  /** The server draft this cart has been saved as (null until review / send). */
  draftId: string | null;
  /** The draft's lines as saved, keyed by the cart line they came from. */
  server: { deliveryDate: string; lines: Record<string, ServerLine> } | null;
  updatedAt: number;
}

export interface CartStore {
  activeSupplierId: string | null;
  carts: Record<string, Cart>;
}

const VERSION = 1;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;

export const storeKey = (restaurantId: string) => `rm:orders:cart:v${VERSION}:${restaurantId}`;

export const emptyCart = (): Cart => ({
  lines: [],
  deliveryDate: '',
  channel: null,
  draftId: null,
  server: null,
  updatedAt: Date.now(),
});

function isLine(x: unknown): x is CartLine {
  if (!x || typeof x !== 'object') return false;
  const l = x as Record<string, unknown>;
  return (
    typeof l.key === 'string' &&
    typeof l.rawDescription === 'string' &&
    typeof l.qty === 'number' &&
    typeof l.unit === 'string' &&
    (l.productId === undefined || typeof l.productId === 'string') &&
    (l.unitPriceExpected === undefined || typeof l.unitPriceExpected === 'number')
  );
}

/** Parse whatever is stored; anything malformed or stale is dropped, never thrown. */
export function parseStore(raw: string | null, now = Date.now()): CartStore {
  const empty: CartStore = { activeSupplierId: null, carts: {} };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<CartStore>;
    if (!v || typeof v !== 'object' || typeof v.carts !== 'object' || v.carts === null) return empty;
    const carts: Record<string, Cart> = {};
    for (const [supplierId, c] of Object.entries(v.carts)) {
      if (!c || typeof c !== 'object' || !Array.isArray(c.lines)) continue;
      if (typeof c.updatedAt !== 'number' || now - c.updatedAt > MAX_AGE_MS) continue;
      const lines = c.lines.filter(isLine);
      if (lines.length === 0 && !c.draftId) continue;
      carts[supplierId] = {
        lines,
        deliveryDate: typeof c.deliveryDate === 'string' ? c.deliveryDate : '',
        channel: c.channel === 'email' || c.channel === 'whatsapp' || c.channel === 'none' ? c.channel : null,
        draftId: typeof c.draftId === 'string' ? c.draftId : null,
        server: c.server && typeof c.server === 'object' ? c.server : null,
        updatedAt: c.updatedAt,
      };
    }
    const active = typeof v.activeSupplierId === 'string' ? v.activeSupplierId : null;
    return { activeSupplierId: active, carts };
  } catch {
    return empty;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadStore(restaurantId: string): CartStore {
  try {
    return parseStore(storage()?.getItem(storeKey(restaurantId)) ?? null);
  } catch {
    return { activeSupplierId: null, carts: {} };
  }
}

export function saveStore(restaurantId: string, store: CartStore): void {
  try {
    const s = storage();
    if (!s) return;
    if (Object.keys(store.carts).length === 0) s.removeItem(storeKey(restaurantId));
    else s.setItem(storeKey(restaurantId), JSON.stringify(store));
  } catch {
    // Quota / blocked storage: the server draft (review + send) still holds the order.
  }
}

/** Put (or, with an empty cart and no server draft, drop) one supplier's cart. */
export function withCart(store: CartStore, supplierId: string, cart: Cart | null): CartStore {
  const carts = { ...store.carts };
  if (!cart || (cart.lines.length === 0 && !cart.draftId)) delete carts[supplierId];
  else carts[supplierId] = cart;
  return { ...store, carts };
}

export interface DraftSyncPlan {
  /** Lines (cart keys) whose server row must change, with the patch. */
  updates: Array<{ key: string; lineId: string; patch: { qtyOrdered?: number; unit?: string; rawDescription?: string; unitPriceExpected?: number | null } }>;
  /** Server rows the cart no longer has. */
  deletes: string[];
  /**
   * The draft can't be patched into the cart (a line was added — there is no
   * add-line procedure yet — every line was removed, or the delivery day changed):
   * save a fresh draft and cancel the stale one.
   */
  replace: boolean;
}

const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === null ? (b ?? null) === null : b != null && Math.round(a! * 1000) === Math.round(b * 1000);

/**
 * How to bring the saved server draft in line with the cart. `deliveryDay` is the
 * EFFECTIVE day the screen shows (the manager's pick, else the supplier's default) —
 * an empty pick does not mean "whatever the draft has".
 */
export function planDraftSync(
  cart: Pick<Cart, 'lines' | 'deliveryDate' | 'server'> & { deliveryDay?: string },
): DraftSyncPlan {
  const plan: DraftSyncPlan = { updates: [], deletes: [], replace: false };
  const server = cart.server;
  if (!server) return { ...plan, replace: true };
  const day = cart.deliveryDay || cart.deliveryDate;
  if (day && day !== server.deliveryDate) plan.replace = true;
  const keys = new Set(cart.lines.map((l) => l.key));
  for (const l of cart.lines) {
    const s = server.lines[l.key];
    if (!s) {
      plan.replace = true;
      continue;
    }
    const patch: DraftSyncPlan['updates'][number]['patch'] = {};
    if (!sameNum(l.qty, s.qty)) patch.qtyOrdered = l.qty;
    if (l.unit.trim() !== s.unit) patch.unit = l.unit.trim();
    if (!l.productId && l.rawDescription.trim() !== (s.rawDescription ?? '')) patch.rawDescription = l.rawDescription.trim();
    if (!sameNum(l.unitPriceExpected, s.unitPriceExpected)) patch.unitPriceExpected = l.unitPriceExpected ?? null;
    if (Object.keys(patch).length > 0) plan.updates.push({ key: l.key, lineId: s.id, patch });
  }
  for (const [key, s] of Object.entries(server.lines)) if (!keys.has(key)) plan.deletes.push(s.id);
  if (cart.lines.length === 0) plan.replace = true;
  return plan;
}

/**
 * Pair the rows read back from a just-saved draft with the cart lines they were
 * created from (createDraft returns only the PO id; rows come back in display
 * order). Greedy on product / description + unit + qty, then on what's left.
 */
export function pairServerLines(lines: CartLine[], rows: ServerLine[]): Record<string, ServerLine> {
  const left = rows.slice();
  const out: Record<string, ServerLine> = {};
  const take = (pred: (r: ServerLine) => boolean) => {
    const i = left.findIndex(pred);
    return i >= 0 ? left.splice(i, 1)[0]! : undefined;
  };
  const pending: CartLine[] = [];
  for (const l of lines) {
    const r = take(
      (s) =>
        (l.productId ? s.productId === l.productId : !s.productId && (s.rawDescription ?? '') === l.rawDescription.trim()) &&
        s.unit === l.unit.trim() &&
        sameNum(s.qty, l.qty),
    );
    if (r) out[l.key] = r;
    else pending.push(l);
  }
  for (const l of pending) {
    const r = take((s) => (l.productId ? s.productId === l.productId : !s.productId)) ?? left.shift();
    if (r) out[l.key] = r;
  }
  return out;
}
