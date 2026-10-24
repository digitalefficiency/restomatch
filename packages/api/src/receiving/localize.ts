/**
 * Receiver languages (wave 1, flag `receiverLanguages`): render the Hebrew
 * names a receiver sees — PO lines, invoice lines and their products — in
 * Arabic / Russian / Thai / Tigrinya.
 *
 * Order: translation_cache (0052, per restaurant + locale) → TargetGlossary →
 * Claude (claude-haiku-5-5, under the same per-restaurant hourly budget as the
 * English leg) → nothing (the UI then shows the English rendering, then the
 * Hebrew). New translations are written to the cache (ON CONFLICT DO NOTHING),
 * so a name is translated at most once per restaurant and language.
 *
 * Tenant scope: the caller passes the session restaurant; PO / invoice are
 * re-verified against it (foreign ids → NOT_FOUND) and the cache is keyed by
 * it (and RLS-scoped). Display-only: matching, exports and the ₪ math never
 * read any of this.
 */
import {
  and,
  eq,
  inArray,
  invoiceLines,
  invoices,
  poLines,
  products,
  purchaseOrders,
  translationCache,
  type Database,
} from '@restomatch/db';
import {
  createTargetTranslator,
  defaultGlossary,
  translateUnit,
  type TargetLocale,
  type TargetTranslator,
} from '@restomatch/translate';
import { TRPCError } from '@trpc/server';
import { takeClaudeBudget } from './english';

const MAX_ROWS = 400;
const MAX_TEXT = 400;
/** At most one Claude batch per call (the hourly budget unit = one batch). */
const MAX_CLAUDE_MISSES = 80;

/** "4 ל׳" → "4 L", "(שישייה)" → "(six-pack)", "3%" → "3%" (English glossary + unit map). */
export function renderSizeSuffix(suffix: string): string | null {
  const s = suffix.trim();
  if (/^\d+(?:[.,]\d+)?\s*%?$/.test(s)) return s.replace(/\s+/g, '');
  const m = /^(\d+(?:[.,]\d+)?)\s*(\S.*)$/.exec(s); // \S: no ambiguous split of the spaces (ReDoS)
  if (m) {
    const unit = translateUnit(m[2]!);
    return unit ? `${m[1]} ${unit}` : null;
  }
  const inner = /^\((.*)\)$/.exec(s);
  const g = defaultGlossary().translate(inner ? inner[1]! : s);
  if (!g) return null;
  return inner ? `(${g})` : g;
}

let defaultTranslator: TargetTranslator | null = null;
export function receiverTranslator(): TargetTranslator {
  defaultTranslator ??= createTargetTranslator(process.env, { suffixRenderer: renderSizeSuffix });
  return defaultTranslator;
}

/** Test seam. */
export function __setReceiverTranslator(t: TargetTranslator | null): void {
  defaultTranslator = t;
}

export interface LocalNamesResult {
  locale: TargetLocale;
  /** Hebrew (trimmed) → localized text, for every name we could translate. */
  names: Record<string, string>;
  untranslated: number;
  cached: number;
  claude: boolean;
}

export async function localNames(
  db: Database,
  restaurantId: string,
  scope: { poId?: string; invoiceId?: string },
  locale: TargetLocale,
  translator: TargetTranslator = receiverTranslator(),
): Promise<LocalNamesResult> {
  const texts = new Set<string>();
  const productIds = new Set<string>();
  const add = (t: string | null | undefined) => {
    const v = t?.trim();
    if (v && v.length <= MAX_TEXT) texts.add(v);
  };

  if (scope.poId) {
    const [po] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, scope.poId), eq(purchaseOrders.restaurantId, restaurantId)))
      .limit(1);
    if (!po) throw new TRPCError({ code: 'NOT_FOUND', message: 'purchase order not found' });
    const rows = await db
      .select({ text: poLines.rawDescription, productId: poLines.productId })
      .from(poLines)
      .where(eq(poLines.poId, po.id))
      .limit(MAX_ROWS);
    for (const r of rows) {
      add(r.text);
      if (r.productId) productIds.add(r.productId);
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
      .select({ text: invoiceLines.rawDescription, productId: invoiceLines.productId })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, inv.id))
      .limit(MAX_ROWS);
    for (const r of rows) {
      add(r.text);
      if (r.productId) productIds.add(r.productId);
    }
  }
  if (productIds.size > 0) {
    const rows = await db
      .select({ name: products.canonicalName })
      .from(products)
      .where(and(inArray(products.id, [...productIds]), eq(products.restaurantId, restaurantId)));
    for (const r of rows) add(r.name);
  }

  // Null-prototype map: a line literally named "constructor" must not hit Object.prototype.
  const result: LocalNamesResult = { locale, names: Object.create(null) as Record<string, string>, untranslated: 0, cached: 0, claude: false };
  if (texts.size === 0) return result;
  const all = [...texts];

  const cachedRows = await db
    .select({ source: translationCache.sourceText, text: translationCache.translatedText })
    .from(translationCache)
    .where(
      and(
        eq(translationCache.restaurantId, restaurantId),
        eq(translationCache.locale, locale),
        inArray(translationCache.sourceText, all),
      ),
    );
  for (const r of cachedRows) result.names[r.source] = r.text;
  result.cached = cachedRows.length;

  const misses = all.filter((t) => !Object.hasOwn(result.names, t));
  if (misses.length > 0) {
    const allowClaude = translator.hasClaude ? takeClaudeBudget(restaurantId) : false;
    // Glossary for every miss; Claude for at most one batch of the rest per call.
    const glossaryOnly = await translator.translateMany(misses, locale, { allowClaude: false, scope: restaurantId });
    const claudeAsk = misses.filter((m) => !glossaryOnly.has(m)).slice(0, MAX_CLAUDE_MISSES);
    const translated =
      allowClaude && claudeAsk.length > 0
        ? new Map([
            ...glossaryOnly,
            ...(await translator.translateMany(claudeAsk, locale, { allowClaude: true, scope: restaurantId })),
          ])
        : glossaryOnly;
    result.claude = allowClaude && claudeAsk.length > 0;
    const fresh: Array<typeof translationCache.$inferInsert> = [];
    for (const he of misses) {
      const t = translated.get(he);
      if (!t || t.text.length > MAX_TEXT) {
        result.untranslated += 1;
        continue;
      }
      result.names[he] = t.text;
      fresh.push({ restaurantId, locale, sourceText: he, translatedText: t.text, source: t.source });
    }
    if (fresh.length > 0) {
      await db.insert(translationCache).values(fresh).onConflictDoNothing();
    }
  }
  return result;
}
