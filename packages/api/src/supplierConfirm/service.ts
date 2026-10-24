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
  }>;
  response: { status: 'confirmed' | 'changes'; submittedAt: Date; lines: SupplierResponseLine[]; note: string | null } | null;
}

/** What the supplier sees. `db` = a withRestaurant(link.restaurantId) transaction. */
export async function loadSupplierOrder(db: Database, link: ResolvedLink): Promise<SupplierOrderView | null> {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
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
    })),
    response: resp ?? null,
  };
}

export interface SupplierAnswerInput {
  lines: Array<{ poLineId: string; qtyAvailable?: number | null; proposedUnitPrice?: number | null }>;
  note?: string | null;
}

export type SubmitError = 'NOT_FOUND' | 'ALREADY_ANSWERED' | 'BAD_LINE' | 'BAD_VALUE';

const MAX_QTY = 1_000_000;
const MAX_PRICE = 10_000_000;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Validate + store the supplier's answer. `db` = withRestaurant(link.restaurantId).
 * Every poLineId must belong to THIS order; quantities are 0…MAX, prices > 0.
 * A line equal to the order (same qty, same price) is dropped; no remaining
 * change ⇒ status 'confirmed'. Never touches purchase_orders / po_lines.
 */
export async function submitSupplierAnswer(
  db: Database,
  link: ResolvedLink,
  input: SupplierAnswerInput,
  now: Date = new Date(),
): Promise<{ ok: true; status: 'confirmed' | 'changes' } | { ok: false; error: SubmitError }> {
  const [po] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, link.poId), eq(purchaseOrders.restaurantId, link.restaurantId)))
    .limit(1);
  if (!po) return { ok: false, error: 'NOT_FOUND' };

  const own = await db
    .select({ id: poLines.id, qty: poLines.qtyOrdered, price: poLines.unitPriceExpected })
    .from(poLines)
    .where(eq(poLines.poId, po.id));
  const byId = new Map(own.map((l) => [l.id, l]));

  const seen = new Set<string>();
  const changes: SupplierResponseLine[] = [];
  for (const l of input.lines) {
    const mine = byId.get(l.poLineId);
    if (!mine || seen.has(l.poLineId)) return { ok: false, error: 'BAD_LINE' };
    seen.add(l.poLineId);
    const qty = l.qtyAvailable ?? null;
    const price = l.proposedUnitPrice ?? null;
    if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY)) return { ok: false, error: 'BAD_VALUE' };
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE)) {
      return { ok: false, error: 'BAD_VALUE' };
    }
    const qtyChanged = qty !== null && round(qty, 3) !== round(Number(mine.qty), 3);
    const priceChanged = price !== null && (mine.price == null || round(price, 4) !== round(Number(mine.price), 4));
    if (!qtyChanged && !priceChanged) continue;
    changes.push({
      poLineId: l.poLineId,
      qtyAvailable: qtyChanged ? round(qty!, 3) : null,
      proposedUnitPrice: priceChanged ? round(price!, 4) : null,
    });
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;
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
    unitPriceAgreed: number | null;
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
            proposedUnitPrice: c.proposedUnitPrice,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    },
  };
}
