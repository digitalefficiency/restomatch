import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { createTranslator } from '@/lib/i18n/translate';
import { components } from '@/lib/i18n/messages/components';

/**
 * Activity rows → display text (W2-13).
 *
 * v2 rows (`metadata.v === 2`, written by `persistMatchRun` and the demo seed) carry
 * structured fields only: a machine `title` like `invoice_matched:<number>`, `detail`
 * null, no ₪ and no Hebrew. Every locale, Hebrew included, renders them from the
 * metadata with the reviewed i18n copy.
 *
 * Legacy rows (no `v: 2`): Hebrew shows the stored text. Other locales render from
 * structured metadata when the row has it (invoice number, counts), otherwise the
 * translated event-type label plus the supplier. Stored Hebrew sentences are never
 * parsed.
 *
 * ₪ renders only when the metadata carries it: a redacted row (receiver/chef, G-07)
 * shows no ₪ part at all.
 */
const KNOWN_TYPES = [
  'invoice_received',
  'invoice_matched',
  'discrepancy_approved',
  'discrepancy_rejected',
  'alias_learned',
  'sync_completed',
] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

export interface ActivityInput {
  eventType: string;
  title: string;
  detail: string | null;
  metadata?: unknown;
}

type ActivityMeta = {
  v?: unknown;
  invoiceId?: unknown;
  invoiceNumber?: unknown;
  supplierName?: unknown;
  supplierNameEn?: unknown;
  discrepancyCount?: unknown;
  potentialLossIls?: unknown;
  /** The hero's leak rule (packages/api matchActivitySummary). v2 also writes integer agorot. */
  leakCount?: unknown;
  leakIls?: unknown;
  leakAgorot?: unknown;
  pendingLink?: unknown;
  poMatched?: unknown;
  reviewCount?: unknown;
  totalInclVatIls?: unknown;
  totalInclVatAgorot?: unknown;
  consolidated?: unknown;
  /** Decision rows (W2-04): {v:2, decision, amountAgorot, supplierName}. */
  amountAgorot?: unknown;
};

type T = ReturnType<typeof createTranslator<typeof components.he>>;

const metaOf = (item: ActivityInput): ActivityMeta =>
  item.metadata && typeof item.metadata === 'object' ? (item.metadata as ActivityMeta) : {};

export const isV2 = (item: ActivityInput): boolean => metaOf(item).v === 2;

/** The invoice a row is about, when it names one. */
export function activityInvoiceId(item: ActivityInput): string | null {
  const id = metaOf(item).invoiceId;
  return typeof id === 'string' && id ? id : null;
}

/** Where a row links: the invoice it is about, or nowhere. */
export function activityHref(item: ActivityInput): string | null {
  const id = activityInvoiceId(item);
  return id ? `/dashboard/invoices/${id}` : null;
}

export function activityInvoiceNumber(item: ActivityInput): string | null {
  const n = metaOf(item).invoiceNumber;
  return typeof n === 'string' && n ? n : null;
}

export function localizeActivity(item: ActivityInput, locale: Locale): { title: string; detail: string | null } {
  const v2 = isV2(item);
  if (locale === 'he' && !v2) return { title: item.title, detail: item.detail };
  const t = createTranslator(locale, components);
  const fromMeta = fromMetadata(item.eventType, metaOf(item), locale, t);
  if (fromMeta) return fromMeta;
  return labelOnly(item, locale, t);
}

/** Type label + supplier from metadata: the fallback for a row we cannot render from numbers. */
function labelOnly(item: ActivityInput, locale: Locale, t: T): { title: string; detail: string | null } {
  const type: KnownType | 'other' = (KNOWN_TYPES as readonly string[]).includes(item.eventType)
    ? (item.eventType as KnownType)
    : 'other';
  const m = metaOf(item);
  const supplier = supplierOf(m, locale);
  const money = ils(agorot(m.amountAgorot), locale);
  const detail =
    type === 'discrepancy_approved' && money
      ? [supplier, t('activity.savings', { amount: money })]
      : [supplier];
  return { title: t(`activity.types.${type}`), detail: detail.filter(Boolean).join(' · ') || null };
}

function supplierOf(m: ActivityMeta, locale: Locale): string | null {
  if (locale !== 'he' && typeof m.supplierNameEn === 'string' && m.supplierNameEn) return m.supplierNameEn;
  return typeof m.supplierName === 'string' && m.supplierName ? m.supplierName : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const agorot = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : n / 100;
};
const ils = (v: number | null, locale: Locale): string | null => (v == null ? null : formatIls(v, { locale }));

function fromMetadata(
  eventType: string,
  m: ActivityMeta,
  locale: Locale,
  t: T,
): { title: string; detail: string | null } | null {
  if (typeof m.invoiceNumber !== 'string' || !m.invoiceNumber) return null;
  const number = m.invoiceNumber;
  const supplier = supplierOf(m, locale);

  if (eventType === 'invoice_received') {
    const title = m.consolidated
      ? t('activity.consolidatedReceivedNumbered', { number })
      : t('activity.invoiceReceivedNumbered', { number });
    const total = ils(agorot(m.totalInclVatAgorot) ?? num(m.totalInclVatIls), locale);
    const second = m.consolidated
      ? t('activity.awaitingDeliveryNotes')
      : total
        ? t('activity.inclVat', { amount: total })
        : null;
    return { title, detail: [supplier, second].filter(Boolean).join(' · ') || null };
  }
  if (eventType === 'invoice_matched') {
    const title = t('activity.invoiceMatchedNumbered', { number });
    const leakMoney = ils(agorot(m.leakAgorot) ?? num(m.leakIls), locale);
    if (typeof m.poMatched === 'boolean') {
      // Worded from the findings (packages/api matchActivitySummary): PO state, ₪ in gaps, then what is left to review.
      const leakCount = num(m.leakCount) ?? 0;
      const review = num(m.reviewCount) ?? 0;
      const parts: Array<string | null> = [supplier];
      if (!m.poMatched) parts.push(m.pendingLink === true ? t('activity.awaitingPoLink') : t('activity.noPoLinked'));
      if (leakCount > 0) {
        parts.push(t('feed.discrepancies', { count: leakCount }));
        if (leakMoney) parts.push(t('activity.potentialLoss', { amount: leakMoney }));
      } else if (review > 0) {
        parts.push(t('feed.toReview', { count: review }));
      } else if (m.poMatched) {
        parts.push(t('activity.matchesOrder'));
      }
      return { title, detail: parts.filter(Boolean).join(' · ') || null };
    }
    // No PO yet: calm "waiting for a PO link", like the hero; never a ₪ figure.
    if (m.pendingLink === true) return { title, detail: [supplier, t('activity.awaitingPoLink')].filter(Boolean).join(' · ') };
    const hasLeak = num(m.leakCount) != null;
    const count = hasLeak ? (m.leakCount as number) : num(m.discrepancyCount);
    const money = hasLeak ? leakMoney : ils(num(m.potentialLossIls), locale);
    const parts =
      count === 0
        ? [supplier, t('activity.matchesOrder')]
        : [
            supplier,
            count != null ? t('feed.discrepancies', { count }) : null,
            money ? t('activity.potentialLoss', { amount: money }) : null,
          ];
    return { title, detail: parts.filter(Boolean).join(' · ') || null };
  }
  return null;
}

/**
 * One row per object: an invoice's "received" and "matched" events (and a re-match)
 * collapse into the newest one. Input is newest-first (the feed order); output keeps it.
 */
export function groupActivity<I extends ActivityInput & { id: string }>(items: readonly I[]): I[] {
  const seen = new Set<string>();
  const out: I[] = [];
  for (const item of items) {
    const invoiceId = activityInvoiceId(item);
    const groupable = invoiceId && (item.eventType === 'invoice_received' || item.eventType === 'invoice_matched');
    if (groupable) {
      if (seen.has(invoiceId)) continue;
      seen.add(invoiceId);
    }
    out.push(item);
  }
  return out;
}
