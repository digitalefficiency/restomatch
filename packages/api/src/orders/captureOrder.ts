import { createHash } from 'node:crypto';
import {
  and,
  eq,
  poLines,
  products,
  purchaseOrders,
  sql,
  supplierCatalogItems,
  suppliers,
  type Database,
} from '@restomatch/db';
import { matchByAlias } from '@restomatch/catalog';
import { normalizePhone } from '@restomatch/ingest';
import { ORDER_TEXT_MAX_CHARS, type OrderTextExtraction, type OrderTextParser } from '@restomatch/ocr';
import { estimateTotal } from './totals';

/**
 * Order capture (flag `orderCapture`): an owner's WhatsApp/e-mail order
 * message → a DRAFT purchase order, so the 3-way match can run on orders that
 * never had a PO. The owner confirms with one tap (placeOrder with
 * channel 'none': draft → sent, nothing is transmitted — the supplier already
 * has the message).
 *
 * Runs inside the caller's restaurant transaction (RLS); every read and write
 * is restaurant-scoped. It never creates a supplier: an unknown supplier comes
 * back as `needs_supplier` with candidates for the owner to pick from.
 */

export interface CaptureArgs {
  restaurantId: string;
  text: string;
  parser: OrderTextParser;
  /** Owner-picked supplier (after `needs_supplier`), checked to be this restaurant's. */
  supplierId?: string | null;
  /** WhatsApp sender of the message — matched against suppliers.contact_whatsapp. */
  senderPhone?: string | null;
  source: 'whatsapp' | 'manual';
  createdBy?: string | null;
}

export interface CapturedLine {
  productName: string;
  qty: number;
  unit: string;
  unitPrice: number | null;
  productId: string | null;
  /** The matched catalog product's name, when matched. */
  catalogName: string | null;
}

export interface SupplierCandidate {
  id: string;
  name: string;
  nameEn: string | null;
}

export type CaptureResult =
  | { status: 'no_lines' }
  | {
      status: 'needs_supplier';
      supplierName: string | null;
      candidates: SupplierCandidate[];
      lines: Array<Pick<CapturedLine, 'productName' | 'qty' | 'unit' | 'unitPrice'>>;
    }
  | {
      status: 'draft';
      poId: string;
      /** false → the same message was captured before; the existing draft is returned. */
      created: boolean;
      supplier: SupplierCandidate;
      matchedBy: 'picked' | 'phone' | 'name';
      lineCount: number;
      mappedCount: number;
    };

/** Stable, restaurant-local idempotency key for one order message. */
export function captureSourceRef(text: string): string {
  const norm = text.replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `capture:${createHash('sha256').update(norm).digest('hex').slice(0, 40)}`;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/["'׳״.,\-–()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Supplier resolution, most specific first: the owner's pick, the sender's
 * phone, the explicit "ספק:" name, then a supplier name that appears in the
 * text. Ambiguity (two suppliers match) is never guessed — it asks.
 */
async function resolveSupplier(
  db: Database,
  args: CaptureArgs,
  extraction: OrderTextExtraction,
): Promise<{ supplier: SupplierCandidate; matchedBy: 'picked' | 'phone' | 'name' } | { candidates: SupplierCandidate[] }> {
  const rows = await db
    .select({ id: suppliers.id, name: suppliers.name, nameEn: suppliers.nameEn, whatsapp: suppliers.contactWhatsapp })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, args.restaurantId), eq(suppliers.active, true)));
  const pick = (r: (typeof rows)[number]): SupplierCandidate => ({ id: r.id, name: r.name, nameEn: r.nameEn });

  if (args.supplierId) {
    const r = rows.find((s) => s.id === args.supplierId);
    if (r) return { supplier: pick(r), matchedBy: 'picked' };
    return { candidates: rows.map(pick) };
  }

  const phone = args.senderPhone ? normalizePhone(args.senderPhone) : null;
  if (phone) {
    const byPhone = rows.filter((s) => s.whatsapp && normalizePhone(s.whatsapp) === phone);
    if (byPhone.length === 1) return { supplier: pick(byPhone[0]!), matchedBy: 'phone' };
  }

  const named = extraction.supplierName ? fold(extraction.supplierName) : null;
  if (named) {
    const exact = rows.filter((s) => fold(s.name) === named || (s.nameEn && fold(s.nameEn) === named));
    if (exact.length === 1) return { supplier: pick(exact[0]!), matchedBy: 'name' };
  }

  // A supplier name (≥3 chars) appearing in the message: "הזמנה לירקות השרון".
  const hay = ` ${fold(args.text)} `;
  const inText = rows.filter((s) =>
    [s.name, s.nameEn].some((n) => {
      const f = n ? fold(n) : '';
      return f.length >= 3 && (hay.includes(` ${f} `) || hay.includes(` ל${f} `) || hay.includes(` מ${f} `));
    }),
  );
  if (inText.length === 1) return { supplier: pick(inText[0]!), matchedBy: 'name' };

  return { candidates: (inText.length > 1 ? inText : rows).map(pick) };
}

/** Exact catalog match: supplier alias, then the product's own name (he or en). */
async function matchLine(
  db: Database,
  restaurantId: string,
  supplierId: string,
  name: string,
): Promise<{ productId: string; canonicalName: string } | null> {
  const alias = await matchByAlias(db, restaurantId, supplierId, name);
  if (alias) return { productId: alias.productId, canonicalName: alias.canonicalName };
  const lower = name.trim().toLowerCase();
  const [p] = await db
    .select({ id: products.id, canonicalName: products.canonicalName })
    .from(products)
    .where(
      and(
        eq(products.restaurantId, restaurantId),
        sql`(lower(${products.canonicalName}) = ${lower} or lower(coalesce(${products.nameEn}, '')) = ${lower})`,
      ),
    )
    .limit(2);
  return p ? { productId: p.id, canonicalName: p.canonicalName } : null;
}

export async function captureOrderDraft(db: Database, args: CaptureArgs): Promise<CaptureResult> {
  const text = args.text.slice(0, ORDER_TEXT_MAX_CHARS);
  const extraction = await args.parser.parseText(text);
  if (extraction.lines.length === 0) return { status: 'no_lines' };

  const resolved = await resolveSupplier(db, { ...args, text }, extraction);
  if ('candidates' in resolved) {
    return {
      status: 'needs_supplier',
      supplierName: extraction.supplierName,
      candidates: resolved.candidates,
      lines: extraction.lines,
    };
  }
  const { supplier, matchedBy } = resolved;

  // One draft per message per restaurant: a re-forward or a double tap returns
  // the same draft. The advisory lock serialises two concurrent captures.
  const sourceRef = captureSourceRef(text);
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${args.restaurantId}:${sourceRef}`}, 0))`);
  const [existing] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, args.restaurantId), eq(purchaseOrders.sourceRef, sourceRef)))
    .limit(1);
  if (existing) {
    const [counts] = await db
      .select({ lines: sql<number>`count(*)::int`, mapped: sql<number>`count(${poLines.productId})::int` })
      .from(poLines)
      .where(eq(poLines.poId, existing.id));
    return {
      status: 'draft',
      poId: existing.id,
      created: false,
      supplier,
      matchedBy,
      lineCount: Number(counts?.lines ?? 0),
      mappedCount: Number(counts?.mapped ?? 0),
    };
  }

  const lines: CapturedLine[] = [];
  for (const l of extraction.lines) {
    const m = await matchLine(db, args.restaurantId, supplier.id, l.productName);
    lines.push({ ...l, productId: m?.productId ?? null, catalogName: m?.canonicalName ?? null });
  }

  // A price the message doesn't state comes from the supplier's catalog list price.
  const productIds = lines.map((l) => l.productId).filter((id): id is string => !!id);
  const listPrice = new Map<string, number>();
  if (productIds.length > 0) {
    const cat = await db
      .select({ productId: supplierCatalogItems.productId, listPrice: supplierCatalogItems.listPrice })
      .from(supplierCatalogItems)
      .where(and(eq(supplierCatalogItems.restaurantId, args.restaurantId), eq(supplierCatalogItems.supplierId, supplier.id)));
    for (const r of cat) if (r.productId && r.listPrice != null) listPrice.set(r.productId, Number(r.listPrice));
  }
  const priced = lines.map((l) => ({
    ...l,
    unitPrice: l.unitPrice ?? (l.productId ? (listPrice.get(l.productId) ?? null) : null),
  }));

  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId: args.restaurantId,
      supplierId: supplier.id,
      status: 'draft',
      source: args.source,
      sourceRef,
      totalEstimated: estimateTotal(priced.map((l) => ({ qty: l.qty, unitPriceExpected: l.unitPrice ?? undefined }))),
      notes: text.slice(0, 2000),
      createdBy: args.createdBy ?? null,
    })
    .returning({ id: purchaseOrders.id });
  if (!po) throw new Error('failed to create the captured purchase order');

  await db.insert(poLines).values(
    priced.map((l) => ({
      poId: po.id,
      productId: l.productId,
      rawDescription: l.productName,
      qtyOrdered: l.qty.toString(),
      unit: l.unit,
      unitPriceExpected: l.unitPrice == null ? null : l.unitPrice.toString(),
    })),
  );

  return {
    status: 'draft',
    poId: po.id,
    created: true,
    supplier,
    matchedBy,
    lineCount: priced.length,
    mappedCount: priced.filter((l) => l.productId).length,
  };
}
