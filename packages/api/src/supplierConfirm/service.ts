import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  supplierResponses,
  suppliers,
  type Database,
  type SupplierResponseLine,
} from '@restomatch/db';
import { featureEnabled } from '../lib/features';
import { isFeatureOn } from '../lib/featureGate';
import { contractPricesForOrder, isContractPrice, orderPriceKey } from '../contracts/orderPrices';

/**
 * Supplier confirmation portal (wave-1 `supplierConfirm`).
 *
 * SECURITY MODEL
 *  - A link is a 32-byte random token (base64url, 43 chars, 256 bits). Only its
 *    SHA-256 is stored; the raw token exists in the URL handed to the supplier.
 *  - `resolveSupplierToken` is the ONLY query that runs without a tenant scope
 *    (on the caller-supplied owner/auth connection, same pattern as
 *    team.acceptInvite): it maps hash → (restaurant, po) after checking expiry,
 *    revocation and the restaurant's flag. Everything else runs in a
 *    withRestaurant() transaction under RLS with explicit restaurant_id filters.
 *  - One link = one order of one restaurant; 72h lifetime; the first answer per
 *    order wins (UNIQUE(po_id)) — a replayed or second submit is refused.
 *  - The purchase order is never written.
 */

export const LINK_TTL_MS = 72 * 60 * 60 * 1000;
/** Orders a supplier can be asked to confirm (sent, not yet received/closed). */
const CONFIRMABLE_STATUSES = ['sent', 'confirmed', 'partial'] as const;
const isConfirmable = (status: string) => (CONFIRMABLE_STATUSES as readonly string[]).includes(status);
/** Cancelled or closed: the order is over, so the supplier needs no answer (not "ask for a new link"). */
const isClosed = (status: string) => status === 'cancelled' || status === 'closed';

/** The answer's bounds (G-10). The portal reads them from `SupplierOrderView.limits`, so client and server share one source. */
export const SUPPLIER_MAX_QTY = 1_000_000;
export const SUPPLIER_MAX_PRICE = 10_000_000;

/**
 * A fingerprint of the order's lines AS THE SUPPLIER SAW THEM (id, ordered qty,
 * order price), so an answer to a form that is now stale (the PO was
 * re-imported or edited after the supplier opened it) is refused with
 * ORDER_CHANGED instead of storing a shortage the supplier never typed.
 */
export function linesVersionOf(
  lines: ReadonlyArray<{ id: string; qty: number | string; price: number | string | null; unit: string }>,
): string {
  // Only what the supplier SEES on a line (G-10 round 3): a product mapping
  // confirmed by the restaurant changes nothing on the form, so it must not
  // invalidate an open answer.
  const canon = [...lines]
    .map((l) => `${l.id}:${Math.round(Number(l.qty) * 1000)}:${l.price == null ? '-' : Math.round(Number(l.price) * 10_000)}:${l.unit}`)
    .sort()
    .join('|');
  return createHash('sha256').update(canon, 'utf8').digest('base64url').slice(0, 22);
}
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSupplierToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare of two hex hashes (defence in depth after the indexed lookup). */
function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type SupplierLinkError = 'NOT_FOUND' | 'EXPIRED';

export interface ResolvedLink {
  linkId: string;
  restaurantId: string;
  poId: string;
  expiresAt: Date;
}

/**
 * Map a raw token to its link. Runs on an RLS-bypassing connection (there is no
 * tenant yet) and therefore reads ONLY supplier_confirm_links + the restaurant's
 * settings. Malformed, unknown, revoked and flag-off tokens are all NOT_FOUND
 * (indistinguishable to a guesser); a known-but-expired link is EXPIRED.
 */
export async function resolveSupplierToken(
  adminDb: Database,
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; link: ResolvedLink } | { ok: false; error: SupplierLinkError }> {
  if (!TOKEN_RE.test(token)) return { ok: false, error: 'NOT_FOUND' };
  const hash = hashSupplierToken(token);
  const [row] = await adminDb
    .select({
      id: supplierConfirmLinks.id,
      restaurantId: supplierConfirmLinks.restaurantId,
      poId: supplierConfirmLinks.poId,
      tokenHash: supplierConfirmLinks.tokenHash,
      expiresAt: supplierConfirmLinks.expiresAt,
      revokedAt: supplierConfirmLinks.revokedAt,
      settings: restaurants.settings,
    })
    .from(supplierConfirmLinks)
    .innerJoin(restaurants, eq(restaurants.id, supplierConfirmLinks.restaurantId))
    .where(eq(supplierConfirmLinks.tokenHash, hash))
    .limit(1);
  if (!row || !sameHash(row.tokenHash, hash)) return { ok: false, error: 'NOT_FOUND' };
  if (row.revokedAt || !featureEnabled(row.settings, 'supplierConfirm')) {
    return { ok: false, error: 'NOT_FOUND' };
  }
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, error: 'EXPIRED' };
  return {
    ok: true,
    link: { linkId: row.id, restaurantId: row.restaurantId, poId: row.poId, expiresAt: row.expiresAt },
  };
}

/**
 * Create a 72h link for a sent order. `db` must be scoped to `restaurantId`
 * (member tx) or the service connection; ownership is checked explicitly.
 * Returns null when the order isn't confirmable (draft/closed/cancelled/foreign).
 */
export async function createSupplierLink(
  db: Database,
  restaurantId: string,
  poId: string,
  opts: { userId?: string | null; now?: Date } = {},
): Promise<{ token: string; expiresAt: Date } | null> {
  const [po] = await db
    .select({ id: purchaseOrders.id, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.restaurantId, restaurantId)))
    .limit(1);
  if (!po || !(CONFIRMABLE_STATUSES as readonly string[]).includes(po.status)) return null;
  const now = opts.now ?? new Date();
  const token = mintToken();
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  await db.insert(supplierConfirmLinks).values({
    restaurantId,
    poId,
    tokenHash: hashSupplierToken(token),
    expiresAt,
    createdBy: opts.userId ?? null,
    createdAt: now,
  });
  return { token, expiresAt };
}

/** Absolute portal URL for a raw token. */
/** Strips trailing '/' in linear time (a `/\/+$/` regex is polynomial on long '/' runs). */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export function supplierLinkUrl(baseUrl: string, token: string): string {
  return `${trimTrailingSlashes(baseUrl)}/s/${token}`;
}

/**
 * For the order document (S5, flag `orderPricesOut`): a fresh 72h confirmation
 * link for `poId`, or null when `supplierConfirm` is off for the restaurant or
 * the order isn't sent. Each call mints a new link (old ones stay valid until
 * they expire); the first supplier answer per order wins either way.
 */
export async function confirmationLink(
  db: Database,
  restaurantId: string,
  poId: string,
  opts: { baseUrl: string; userId?: string | null; now?: Date },
): Promise<{ url: string; expiresAt: Date } | null> {
  const [r] = await db
    .select({ settings: restaurants.settings })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!featureEnabled(r?.settings, 'supplierConfirm')) return null;
  const link = await createSupplierLink(db, restaurantId, poId, opts);
  return link ? { url: supplierLinkUrl(opts.baseUrl, link.token), expiresAt: link.expiresAt } : null;
}

export interface SupplierOrderView {
  restaurantName: string;
  supplierName: string;
  supplierNameEn: string | null;
  poId: string;
  poNumber: string;
  expectedDeliveryAt: Date | null;
  expiresAt: Date;
  lines: Array<{
    id: string;
    description: string;
    descriptionEn: string | null;
    supplierSku: string | null;
    qtyOrdered: number;
    unit: string;
    unitPrice: number | null;
    /** `unitPrice` is the contract price in force on the order date. */
    agreed: boolean;
  }>;
  response: { status: 'confirmed' | 'changes'; submittedAt: Date; lines: SupplierResponseLine[]; note: string | null } | null;
  /** G-10: `linesVersionOf` the lines above — the portal sends it back with the answer. */
  linesVersion: string;
  /** G-10: false once the order is no longer open for an answer (no new answer is accepted). */
  confirmable: boolean;
  /** G-10: the order was cancelled or closed (the portal says so, rather than "the link expired"). */
  closed: boolean;
  /** G-10: the answer's bounds, shared with the portal's inputs. */
  limits: { maxQty: number; maxPrice: number };
}

/**
 * Line ids whose order price IS the contract price in force on the order date
 * (flag `contracts`). Only those may be labelled "agreed"; every other price is
 * just "the price on the order".
 */
async function agreedLineIds(
  db: Database,
  restaurantId: string,
  supplierId: string,
  orderedAt: Date,
  lines: ReadonlyArray<{ id: string; productId: string | null; unit: string; price: number | null }>,
): Promise<Set<string>> {
  const priced = lines.filter((l): l is typeof l & { productId: string } => !!l.productId && l.price !== null);
  if (priced.length === 0 || !(await isFeatureOn(db, restaurantId, 'contracts'))) return new Set();
  const contract = await contractPricesForOrder(db, restaurantId, supplierId, priced, orderedAt);
  return new Set(
    priced.filter((l) => isContractPrice(l.price, contract.get(orderPriceKey(l.productId, l.unit)))).map((l) => l.id),
  );
}

/** What the supplier sees. `db` = a withRestaurant(link.restaurantId) transaction. */
export async function loadSupplierOrder(db: Database, link: ResolvedLink): Promise<SupplierOrderView | null> {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      createdAt: purchaseOrders.createdAt,
      status: purchaseOrders.status,
      expectedDeliveryAt: purchaseOrders.expectedDeliveryAt,
      restaurantName: restaurants.name,
      supplierName: suppliers.name,
      supplierNameEn: suppliers.nameEn,
    })
    .from(purchaseOrders)
    .innerJoin(restaurants, eq(restaurants.id, purchaseOrders.restaurantId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.id, link.poId), eq(purchaseOrders.restaurantId, link.restaurantId)))
    .limit(1);
  if (!po) return null;
  const lines = await db
    .select({
      id: poLines.id,
      rawDescription: poLines.rawDescription,
      rawDescriptionEn: poLines.rawDescriptionEn,
      productName: products.canonicalName,
      productNameEn: products.nameEn,
      productId: poLines.productId,
      supplierSku: poLines.supplierSku,
      qtyOrdered: poLines.qtyOrdered,
      unit: poLines.unit,
      unitPriceExpected: poLines.unitPriceExpected,
    })
    .from(poLines)
    .leftJoin(products, eq(products.id, poLines.productId))
    .where(eq(poLines.poId, po.id))
    .orderBy(asc(poLines.id));
  const [resp] = await db
    .select({
      status: supplierResponses.status,
      submittedAt: supplierResponses.submittedAt,
      lines: supplierResponses.lines,
      note: supplierResponses.note,
    })
    .from(supplierResponses)
    .where(and(eq(supplierResponses.poId, po.id), eq(supplierResponses.restaurantId, link.restaurantId)))
    .limit(1);
  const agreed = await agreedLineIds(
    db,
    link.restaurantId,
    po.supplierId,
    po.createdAt,
    lines.map((l) => ({ id: l.id, productId: l.productId, unit: l.unit, price: l.unitPriceExpected == null ? null : Number(l.unitPriceExpected) })),
  );
  return {
    restaurantName: po.restaurantName,
    supplierName: po.supplierName,
    supplierNameEn: po.supplierNameEn,
    poId: po.id,
    poNumber: po.id.slice(0, 8).toUpperCase(),
    expectedDeliveryAt: po.expectedDeliveryAt,
    expiresAt: link.expiresAt,
    lines: lines.map((l) => ({
      id: l.id,
      description: l.productName ?? l.rawDescription ?? '',
      descriptionEn: l.productNameEn ?? l.rawDescriptionEn ?? null,
      supplierSku: l.supplierSku,
      qtyOrdered: Number(l.qtyOrdered),
      unit: l.unit,
      unitPrice: l.unitPriceExpected == null ? null : Number(l.unitPriceExpected),
      agreed: agreed.has(l.id),
    })),
    response: resp ?? null,
    linesVersion: linesVersionOf(
      lines.map((l) => ({ id: l.id, qty: l.qtyOrdered, price: l.unitPriceExpected, unit: l.unit })),
    ),
    confirmable: isConfirmable(po.status),
    closed: isClosed(po.status),
    limits: { maxQty: SUPPLIER_MAX_QTY, maxPrice: SUPPLIER_MAX_PRICE },
  };
}

/**
 * What the supplier says about the order as a whole (G-10, auth-02):
 * `as_ordered` = every line arrives as ordered; `with_changes` = the lines carry
 * the supplier's quantities (0 = out of stock) and/or prices.
 */
export type SupplierAnswerIntent = 'as_ordered' | 'with_changes';

export interface SupplierAnswerInput {
  /**
   * The supplier's explicit intent. Required at every web boundary
   * (`supplierPortalSubmit`, the public route).
   * @deprecated Omitting it is kept only for older service callers: the intent
   * is then inferred from the diff (any change ⇒ `with_changes`). The
   * completeness rule applies either way.
   */
  intent?: SupplierAnswerIntent;
  /**
   * `SupplierOrderView.linesVersion` of the form the supplier answered. Sent by
   * the portal; when it no longer matches the order → ORDER_CHANGED.
   */
  linesVersion?: string;
  /** EVERY line of the order, exactly once. */
  lines: Array<{ poLineId: string; qtyAvailable?: number | null; proposedUnitPrice?: number | null }>;
  note?: string | null;
}

/**
 * - `BAD_LINE`: a line of another order, or a line twice;
 * - `BAD_VALUE`: a quantity or price out of range;
 * - `INCOMPLETE_ANSWER`: an order line is missing, or `with_changes` leaves a quantity empty;
 * - `INTENT_MISMATCH`: `as_ordered` with a changed line, or `with_changes` with no change and no note;
 * - `ORDER_CHANGED`: the order's lines changed since the supplier opened the form (`linesVersion`);
 * - `ORDER_CLOSED`: the order is cancelled or closed;
 * - `ORDER_NOT_OPEN`: the order is otherwise not open for an answer (e.g. back to draft).
 */
export type SubmitError =
  | 'NOT_FOUND'
  | 'ALREADY_ANSWERED'
  | 'BAD_LINE'
  | 'BAD_VALUE'
  | 'INCOMPLETE_ANSWER'
  | 'INTENT_MISMATCH'
  | 'ORDER_CHANGED'
  | 'ORDER_CLOSED'
  | 'ORDER_NOT_OPEN';

const MAX_QTY = SUPPLIER_MAX_QTY;
const MAX_PRICE = SUPPLIER_MAX_PRICE;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Validate + store the supplier's answer. `db` = withRestaurant(link.restaurantId).
 * The service is the authority on the answer contract (G-10); the route only
 * maps codes:
 *  - every line of THIS order exactly once (a foreign or repeated line is
 *    `BAD_LINE`, a missing one `INCOMPLETE_ANSWER`); quantities 0…MAX, prices > 0;
 *  - `with_changes`: every line states its quantity, and something differs
 *    (or there is a note) — otherwise `INCOMPLETE_ANSWER` / `INTENT_MISMATCH`;
 *  - `as_ordered`: a quantity is null or the ordered one, a price is null or
 *    the order's — any difference is `INTENT_MISMATCH` (never silently dropped).
 * Only differences are stored; `status` = any difference or a note ⇒ 'changes',
 * otherwise 'confirmed'. Never touches purchase_orders / po_lines.
 */
export async function submitSupplierAnswer(
  db: Database,
  link: ResolvedLink,
  input: SupplierAnswerInput,
  now: Date = new Date(),
): Promise<{ ok: true; status: 'confirmed' | 'changes' } | { ok: false; error: SubmitError }> {
  const [po] = await db
    .select({ id: purchaseOrders.id, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, link.poId), eq(purchaseOrders.restaurantId, link.restaurantId)))
    .limit(1);
  if (!po) return { ok: false, error: 'NOT_FOUND' };
  // A replay is always a 409 with the recorded answer — checked before the lines,
  // so a second answer to a since-changed order still reads as "already answered".
  const [answered] = await db
    .select({ id: supplierResponses.id })
    .from(supplierResponses)
    .where(and(eq(supplierResponses.poId, po.id), eq(supplierResponses.restaurantId, link.restaurantId)))
    .limit(1);
  if (answered) return { ok: false, error: 'ALREADY_ANSWERED' };
  if (isClosed(po.status)) return { ok: false, error: 'ORDER_CLOSED' };
  if (!isConfirmable(po.status)) return { ok: false, error: 'ORDER_NOT_OPEN' };

  const own = await db
    .select({ id: poLines.id, qty: poLines.qtyOrdered, price: poLines.unitPriceExpected, unit: poLines.unit })
    .from(poLines)
    .where(eq(poLines.poId, po.id));
  const byId = new Map(own.map((l) => [l.id, l]));
  if (input.linesVersion !== undefined && input.linesVersion !== linesVersionOf(own)) {
    return { ok: false, error: 'ORDER_CHANGED' };
  }

  const seen = new Set<string>();
  const changes: SupplierResponseLine[] = [];
  let qtyMissing = false;
  for (const l of input.lines) {
    const mine = byId.get(l.poLineId);
    if (!mine || seen.has(l.poLineId)) return { ok: false, error: 'BAD_LINE' };
    seen.add(l.poLineId);
    const qty = l.qtyAvailable ?? null;
    // The order's own price (₪0 included) is "no price change" — checked before
    // validity, mirroring the portal, so a ₪0 line's untouched "0" is not BAD_VALUE.
    const sentPrice = l.proposedUnitPrice ?? null;
    const price =
      sentPrice !== null && Number.isFinite(sentPrice) && mine.price != null && round(sentPrice, 4) === round(Number(mine.price), 4)
        ? null
        : sentPrice;
    if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY)) return { ok: false, error: 'BAD_VALUE' };
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE)) {
      return { ok: false, error: 'BAD_VALUE' };
    }
    // Validated as STORED (after rounding): a positive qty that rounds to 0 would
    // read as "out of stock", and a price that rounds to ₪0 is no price.
    if (qty !== null && qty > 0 && round(qty, 3) === 0) return { ok: false, error: 'BAD_VALUE' };
    if (price !== null && round(price, 4) === 0) return { ok: false, error: 'BAD_VALUE' };
    if (qty === null) qtyMissing = true;
    const qtyChanged = qty !== null && round(qty, 3) !== round(Number(mine.qty), 3);
    const priceChanged = price !== null && (mine.price == null || round(price, 4) !== round(Number(mine.price), 4));
    if (!qtyChanged && !priceChanged) continue;
    changes.push({
      poLineId: l.poLineId,
      qtyAvailable: qtyChanged ? round(qty!, 3) : null,
      proposedUnitPrice: priceChanged ? round(price!, 4) : null,
    });
  }
  // A line left out would silently read as "as ordered" (auth-02).
  if (seen.size !== byId.size) return { ok: false, error: 'INCOMPLETE_ANSWER' };
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;
  const intent: SupplierAnswerIntent = input.intent ?? (changes.length > 0 ? 'with_changes' : 'as_ordered');
  if (intent === 'with_changes') {
    if (qtyMissing) return { ok: false, error: 'INCOMPLETE_ANSWER' };
    if (changes.length === 0 && !note) return { ok: false, error: 'INTENT_MISMATCH' };
  } else if (changes.length > 0) {
    return { ok: false, error: 'INTENT_MISMATCH' };
  }
  const status = changes.length > 0 || note ? 'changes' : 'confirmed';

  const inserted = await db
    .insert(supplierResponses)
    .values({
      restaurantId: link.restaurantId,
      poId: po.id,
      linkId: link.linkId,
      status,
      lines: changes,
      note,
      submittedAt: now,
    })
    .onConflictDoNothing({ target: supplierResponses.poId })
    .returning({ id: supplierResponses.id });
  if (inserted.length === 0) return { ok: false, error: 'ALREADY_ANSWERED' };
  return { ok: true, status };
}

export interface SupplierResponseDiff {
  status: 'confirmed' | 'changes';
  submittedAt: Date;
  note: string | null;
  lines: Array<{
    poLineId: string;
    description: string;
    descriptionEn: string | null;
    unit: string;
    qtyOrdered: number;
    qtyAvailable: number | null;
    /** The unit price on the order (the PO is never rewritten). */
    unitPriceAgreed: number | null;
    /** `unitPriceAgreed` is the contract price in force on the order date. */
    agreed: boolean;
    proposedUnitPrice: number | null;
  }>;
}

/** The restaurant's view: the answer as differences against the (unchanged) PO. */
export async function supplierResponseDiff(
  db: Database,
  restaurantId: string,
  poId: string,
): Promise<{ response: SupplierResponseDiff | null; latestLink: { expiresAt: Date; createdAt: Date } | null }> {
  const [resp] = await db
    .select()
    .from(supplierResponses)
    .where(and(eq(supplierResponses.poId, poId), eq(supplierResponses.restaurantId, restaurantId)))
    .limit(1);
  const [latestLink] = await db
    .select({ expiresAt: supplierConfirmLinks.expiresAt, createdAt: supplierConfirmLinks.createdAt })
    .from(supplierConfirmLinks)
    .where(and(eq(supplierConfirmLinks.poId, poId), eq(supplierConfirmLinks.restaurantId, restaurantId)))
    .orderBy(desc(supplierConfirmLinks.createdAt))
    .limit(1);
  if (!resp) return { response: null, latestLink: latestLink ?? null };
  const ids = resp.lines.map((l) => l.poLineId);
  const lines = ids.length
    ? await db
        .select({
          id: poLines.id,
          rawDescription: poLines.rawDescription,
          rawDescriptionEn: poLines.rawDescriptionEn,
          productName: products.canonicalName,
          productNameEn: products.nameEn,
          productId: poLines.productId,
          supplierId: purchaseOrders.supplierId,
          orderedAt: purchaseOrders.createdAt,
          unit: poLines.unit,
          qty: poLines.qtyOrdered,
          price: poLines.unitPriceExpected,
        })
        .from(poLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
        .leftJoin(products, eq(products.id, poLines.productId))
        .where(and(inArray(poLines.id, ids), eq(purchaseOrders.restaurantId, restaurantId), eq(poLines.poId, poId)))
    : [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const first = lines[0];
  const agreed = first
    ? await agreedLineIds(
        db,
        restaurantId,
        first.supplierId,
        first.orderedAt,
        lines.map((l) => ({ id: l.id, productId: l.productId, unit: l.unit, price: l.price == null ? null : Number(l.price) })),
      )
    : new Set<string>();
  return {
    latestLink: latestLink ?? null,
    response: {
      status: resp.status,
      submittedAt: resp.submittedAt,
      note: resp.note,
      lines: resp.lines
        .map((c) => {
          const l = byId.get(c.poLineId);
          if (!l) return null;
          return {
            poLineId: c.poLineId,
            description: l.productName ?? l.rawDescription ?? '',
            descriptionEn: l.productNameEn ?? l.rawDescriptionEn ?? null,
            unit: l.unit,
            qtyOrdered: Number(l.qty),
            qtyAvailable: c.qtyAvailable,
            unitPriceAgreed: l.price == null ? null : Number(l.price),
            agreed: agreed.has(c.poLineId),
            proposedUnitPrice: c.proposedUnitPrice,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    },
  };
}
