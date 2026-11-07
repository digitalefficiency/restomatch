import { nameKey } from './rounding';

/**
 * W3-10 · one "לקשר" queue. Today three places ask the owner to link a supplier
 * line to a product: invoice lines that carry a SKU, invoice lines without one,
 * and price-list import suggestions. This pure builder merges them into one
 * deduplicated list ranked by the ₪ that is still unmapped (money we cannot
 * check until the link exists), and the summary behind "7 לקישור · ₪1,240".
 */

export type LinkSource = 'sku_line' | 'no_sku_line' | 'import_suggestion';

export interface LinkSuggestion {
  productId: string;
  /** 0..1 */
  confidence: number;
}

export interface LinkCandidate {
  source: LinkSource;
  supplierId: string;
  supplierSku: string | null;
  nameRaw: string;
  /** Σ line totals on unlinked lines, in agorot (0 for an import suggestion with no purchases). */
  unmappedAgorot: number;
  lineCount: number;
  /** ISO timestamp of the last time this name/SKU was seen. */
  lastSeenAt: string;
  suggestion?: LinkSuggestion | null;
}

export interface LinkQueueRow {
  /** Stable id for keys and URLs: supplier + SKU, or supplier + normalised name. */
  key: string;
  supplierId: string;
  supplierSku: string | null;
  nameRaw: string;
  sources: LinkSource[];
  unmappedAgorot: number;
  lineCount: number;
  lastSeenAt: string;
  suggestion: LinkSuggestion | null;
}

export interface LinkQueueSummary {
  count: number;
  unmappedAgorot: number;
}

const SOURCE_ORDER: LinkSource[] = ['sku_line', 'no_sku_line', 'import_suggestion'];

export function linkKey(supplierId: string, supplierSku: string | null, nameRaw: string): string {
  const sku = supplierSku?.trim().toLowerCase();
  return sku ? `${supplierId}|sku:${sku}` : `${supplierId}|name:${nameKey(nameRaw)}`;
}

export function buildLinkQueue(candidates: LinkCandidate[]): LinkQueueRow[] {
  const rows = new Map<string, LinkQueueRow>();
  for (const c of candidates) {
    if (!Number.isInteger(c.unmappedAgorot) || c.unmappedAgorot < 0) {
      throw new RangeError('unmappedAgorot must be a non-negative integer');
    }
    const key = linkKey(c.supplierId, c.supplierSku, c.nameRaw);
    const s = c.suggestion ?? null;
    const prev = rows.get(key);
    if (!prev) {
      rows.set(key, {
        key,
        supplierId: c.supplierId,
        supplierSku: c.supplierSku?.trim() || null,
        nameRaw: c.nameRaw.trim(),
        sources: [c.source],
        unmappedAgorot: c.unmappedAgorot,
        lineCount: c.lineCount,
        lastSeenAt: c.lastSeenAt,
        suggestion: s,
      });
      continue;
    }
    if (!prev.sources.includes(c.source)) prev.sources.push(c.source);
    prev.unmappedAgorot += c.unmappedAgorot;
    prev.lineCount += c.lineCount;
    if (c.lastSeenAt > prev.lastSeenAt) {
      prev.lastSeenAt = c.lastSeenAt;
      prev.nameRaw = c.nameRaw.trim();
    }
    if (s && (!prev.suggestion || s.confidence > prev.suggestion.confidence)) prev.suggestion = s;
  }
  const out = [...rows.values()];
  for (const r of out) r.sources.sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  out.sort(
    (a, b) =>
      b.unmappedAgorot - a.unmappedAgorot ||
      b.lineCount - a.lineCount ||
      (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return out;
}

export function summarizeLinkQueue(rows: LinkQueueRow[]): LinkQueueSummary {
  return { count: rows.length, unmappedAgorot: rows.reduce((s, r) => s + r.unmappedAgorot, 0) };
}
