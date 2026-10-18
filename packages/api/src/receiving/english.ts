/**
 * "Receiver in English" — fill the display-only English columns added by
 * migration 0028 (products.name_en, po_lines.raw_description_en,
 * invoice_lines.raw_description_en) for one PO and/or one invoice.
 *
 * Idempotent: only NULL columns are read and every UPDATE re-checks
 * `… IS NULL`, so a row is translated at most once (a concurrent call, or the
 * OCR worker having already written Claude's rendering, wins). Matching,
 * exports and the ₪ leak math never read these columns.
 *
 * Tenant scope: the caller passes the session restaurant; the PO / invoice are
 * re-verified against it here (defense in depth) and products are only touched
 * when product.restaurant_id matches.
 */
import {
  and,
  eq,
  inArray,
  invoiceLines,
  invoices,
  isNull,
  isNotNull,
  poLines,
  products,
  purchaseOrders,
  type Database,
} from '@restomatch/db';
import { createTranslator, type CompositeTranslator } from '@restomatch/translate';
import { TRPCError } from '@trpc/server';

/** Upper bound of rows handled per call (one tRPC request / one OCR job). */
const MAX_ROWS = 400;

export interface FillEnglishResult {
  productsFilled: number;
  poLinesFilled: number;
  invoiceLinesFilled: number;
  /** Hebrew names we could not translate (shown in Hebrew). */
  untranslated: number;
  /** Whether the Claude leg was available for this call. */
  claude: boolean;
}

let defaultTranslator: CompositeTranslator | null = null;
/** Process-wide translator (glossary + Claude when ANTHROPIC_API_KEY is set). */
export function receivingTranslator(): CompositeTranslator {
  defaultTranslator ??= createTranslator();
  return defaultTranslator;
}

/** Test seam. */
export function __setReceivingTranslator(t: CompositeTranslator | null): void {
  defaultTranslator = t;
}

export async function fillEnglishNames(
  db: Database,
  restaurantId: string,
  scope: { poId?: string; invoiceId?: string },
  translator: CompositeTranslator = receivingTranslator(),
): Promise<FillEnglishResult> {
  const result: FillEnglishResult = {
    productsFilled: 0,
    poLinesFilled: 0,
    invoiceLinesFilled: 0,
    untranslated: 0,
    claude: translator.hasClaude,
  };

  const poLineRows: Array<{ id: string; text: string; productId: string | null }> = [];
  const invLineRows: Array<{ id: string; text: string; productId: string | null }> = [];
  const productIds = new Set<string>();

  if (scope.poId) {
    const [po] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, scope.poId), eq(purchaseOrders.restaurantId, restaurantId)))
      .limit(1);
    if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
    const rows = await db
      .select({
        id: poLines.id,
        text: poLines.rawDescription,
        en: poLines.rawDescriptionEn,
        productId: poLines.productId,
      })
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .limit(MAX_ROWS);
    for (const r of rows) {
      if (r.productId) productIds.add(r.productId);
      if (r.en == null && r.text) poLineRows.push({ id: r.id, text: r.text, productId: r.productId });
    }
  }

  if (scope.invoiceId) {
    const [inv] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, scope.invoiceId), eq(invoices.restaurantId, restaurantId)))
      .limit(1);
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice not found' });
    const rows = await db
      .select({
        id: invoiceLines.id,
        text: invoiceLines.rawDescription,
        en: invoiceLines.rawDescriptionEn,
        productId: invoiceLines.productId,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, inv.id))
      .limit(MAX_ROWS);
    for (const r of rows) {
      if (r.productId) productIds.add(r.productId);
      if (r.en == null && r.text) invLineRows.push({ id: r.id, text: r.text, productId: r.productId });
    }
  }

  const productRows =
    productIds.size > 0
      ? await db
          .select({ id: products.id, name: products.canonicalName })
          .from(products)
          .where(
            and(
              inArray(products.id, [...productIds]),
              eq(products.restaurantId, restaurantId),
              isNull(products.nameEn),
            ),
          )
      : [];

  const texts = [...poLineRows, ...invLineRows].map((r) => r.text).concat(productRows.map((p) => p.name));
  if (texts.length === 0) return result;

  const translated = await translator.translateMany(texts);
  const enOf = (text: string): string | null => translated.get(text.trim())?.en ?? null;

  // Group row ids by English text → one UPDATE per distinct name.
  async function apply(
    rows: Array<{ id: string; text: string }>,
    update: (ids: string[], en: string) => Promise<number>,
  ): Promise<number> {
    const byEn = new Map<string, string[]>();
    for (const r of rows) {
      const en = enOf(r.text);
      if (!en) {
        result.untranslated += 1;
        continue;
      }
      byEn.set(en, [...(byEn.get(en) ?? []), r.id]);
    }
    let n = 0;
    for (const [en, ids] of byEn) n += await update(ids, en);
    return n;
  }

  result.poLinesFilled = await apply(poLineRows, async (ids, en) =>
    (
      await db
        .update(poLines)
        .set({ rawDescriptionEn: en })
        .where(and(inArray(poLines.id, ids), isNull(poLines.rawDescriptionEn)))
        .returning({ id: poLines.id })
    ).length,
  );

  result.invoiceLinesFilled = await apply(invLineRows, async (ids, en) =>
    (
      await db
        .update(invoiceLines)
        .set({ rawDescriptionEn: en })
        .where(and(inArray(invoiceLines.id, ids), isNull(invoiceLines.rawDescriptionEn)))
        .returning({ id: invoiceLines.id })
    ).length,
  );

  // Products: translate the canonical name; if that fails, borrow the English
  // of a line linked to the product (e.g. Claude's OCR rendering).
  const lineEnByProduct = new Map<string, string>();
  if (productRows.length > 0) {
    const linked = await db
      .select({ productId: invoiceLines.productId, en: invoiceLines.rawDescriptionEn })
      .from(invoiceLines)
      .innerJoin(invoices, and(eq(invoices.id, invoiceLines.invoiceId), eq(invoices.restaurantId, restaurantId)))
      .where(
        and(
          inArray(
            invoiceLines.productId,
            productRows.map((p) => p.id),
          ),
          isNotNull(invoiceLines.rawDescriptionEn),
        ),
      )
      .limit(MAX_ROWS);
    for (const l of linked) if (l.productId && l.en) lineEnByProduct.set(l.productId, l.en);
  }
  for (const p of productRows) {
    const en = enOf(p.name) ?? lineEnByProduct.get(p.id) ?? null;
    if (!en) {
      result.untranslated += 1;
      continue;
    }
    const updated = await db
      .update(products)
      .set({ nameEn: en })
      .where(and(eq(products.id, p.id), eq(products.restaurantId, restaurantId), isNull(products.nameEn)))
      .returning({ id: products.id });
    result.productsFilled += updated.length;
  }

  return result;
}

/**
 * Catalog backfill (worker script): translate every product of one restaurant
 * that has no name_en yet, in batches.
 */
export async function fillCatalogEnglish(
  db: Database,
  restaurantId: string,
  translator: CompositeTranslator = receivingTranslator(),
  batchSize = 100,
): Promise<{ filled: number; untranslated: number; total: number }> {
  const rows = await db
    .select({ id: products.id, name: products.canonicalName })
    .from(products)
    .where(and(eq(products.restaurantId, restaurantId), isNull(products.nameEn)));
  let filled = 0;
  let untranslated = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const translated = await translator.translateMany(chunk.map((r) => r.name));
    for (const r of chunk) {
      const en = translated.get(r.name.trim())?.en;
      if (!en) {
        untranslated += 1;
        continue;
      }
      const updated = await db
        .update(products)
        .set({ nameEn: en })
        .where(and(eq(products.id, r.id), eq(products.restaurantId, restaurantId), isNull(products.nameEn)))
        .returning({ id: products.id });
      filled += updated.length;
    }
  }
  return { filled, untranslated, total: rows.length };
}
