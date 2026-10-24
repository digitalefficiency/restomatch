import type { Locale } from '@/lib/i18n/config';
import { formatIls } from '@/lib/money';
import { createTranslator } from '@/lib/i18n/translate';
import { components } from '@/lib/i18n/messages/components';

/**
 * Activity rows are stored with Hebrew title/detail text written by the API
 * (`logActivity` callers + the demo seed). Hebrew renders them verbatim; English
 * rebuilds the known templates from their numbers and falls back to a
 * translated event-type label — never shows Hebrew sentences to an English user
 * unless it is a proper noun (supplier name) or free text (a rejection reason).
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

const HEBREW = /[֐-׿]/;

function amountOf(raw: string): number | null {
  const n = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function localizeActivity(
  item: { eventType: string; title: string; detail: string | null; metadata?: unknown },
  locale: Locale,
): { title: string; detail: string | null } {
  if (locale === 'he') return { title: item.title, detail: item.detail };
  const t = createTranslator(locale, components);

  // Preferred path: structured metadata written by the match/approval writers and
  // the demo seed. Falls through to the Hebrew-template parsing for older rows.
  const fromMeta = fromMetadata(item.eventType, item.metadata, locale, t);
  if (fromMeta) return fromMeta;

  const type: KnownType | 'other' = (KNOWN_TYPES as readonly string[]).includes(item.eventType)
    ? (item.eventType as KnownType)
    : 'other';
  let title = t(`activity.types.${type}`);
  const numbered = /^חשבונית\s+(\S+)\s+הותאמה$/.exec(item.title.trim());
  if (numbered) title = t('activity.invoiceMatchedNumbered', { number: numbered[1]! });
  else if (!HEBREW.test(item.title)) title = item.title;

  if (!item.detail) return { title, detail: null };
  const parts = item.detail.split('·').map((p) => p.trim());
  const out = parts.map((part) => {
    if (part === 'חריגה אחת') return t('activity.discrepancyOne');
    if (part === 'ממתינה לשיוך להזמנה') return t('activity.awaitingPoLink');
    if (part === 'ללא הזמנה מקושרת') return t('activity.noPoLinked');
    if (part === 'חריגה אחת לבדיקה') return t('activity.toReviewOne');
    {
      const r = /^(\d+)\s+חריגות לבדיקה$/.exec(part);
      if (r) return t('activity.toReview', { count: r[1]! });
    }
    let m = /^(\d+)\s+חריגות$/.exec(part);
    if (m) return t('activity.discrepancies', { count: m[1]! });
    m = /^הפסד פוטנציאלי\s+(.+)$/.exec(part);
    if (m) {
      const n = amountOf(m[1]!);
      return n == null ? part : t('activity.potentialLoss', { amount: formatIls(n, { locale }) });
    }
    m = /^חיסכון\s+(.+)$/.exec(part);
    if (m) {
      const n = amountOf(m[1]!);
      return n == null ? part : t('activity.savings', { amount: formatIls(n, { locale }) });
    }
    // Seed / worker detail templates (invoice received / matched / pending).
    m = /^(₪\s*[\d,.]+)\s+כולל מע״מ$/.exec(part);
    if (m) {
      const n = amountOf(m[1]!);
      return n == null ? part : t('activity.inclVat', { amount: formatIls(n, { locale }) });
    }
    if (part === 'תואמת להזמנה ולקבלה') return t('activity.matchesOrderAndReceipt');
    if (part === 'ממתינה להתאמה מול תעודות המשלוח של החודש') return t('activity.awaitingMonthlyMatch');
    // Supplier names / free-text reasons stay as written.
    return part;
  });
  return { title, detail: out.join(' · ') };
}

type ActivityMeta = {
  invoiceNumber?: unknown;
  supplierName?: unknown;
  supplierNameEn?: unknown;
  discrepancyCount?: unknown;
  potentialLossIls?: unknown;
  /** The hero's leak rule (packages/api matchActivitySummary) — preferred over the engine totals. */
  leakCount?: unknown;
  leakIls?: unknown;
  pendingLink?: unknown;
  poMatched?: unknown;
  reviewCount?: unknown;
  totalInclVatIls?: unknown;
  consolidated?: unknown;
};

function fromMetadata(
  eventType: string,
  metadata: unknown,
  locale: Locale,
  t: ReturnType<typeof createTranslator<typeof components.he>>,
): { title: string; detail: string | null } | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as ActivityMeta;
  if (typeof m.invoiceNumber !== 'string' || !m.invoiceNumber) return null;
  const number = m.invoiceNumber;
  const supplier =
    typeof m.supplierNameEn === 'string' && m.supplierNameEn
      ? m.supplierNameEn
      : typeof m.supplierName === 'string'
        ? m.supplierName
        : null;
  const ils = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? formatIls(v, { locale }) : null);

  if (eventType === 'invoice_received') {
    const title = m.consolidated
      ? t('activity.consolidatedReceivedNumbered', { number })
      : t('activity.invoiceReceivedNumbered', { number });
    const total = ils(m.totalInclVatIls);
    const second = m.consolidated
      ? t('activity.awaitingDeliveryNotes')
      : total
        ? t('activity.inclVat', { amount: total })
        : null;
    return { title, detail: [supplier, second].filter(Boolean).join(' · ') || null };
  }
  if (eventType === 'invoice_matched') {
    const title = t('activity.invoiceMatchedNumbered', { number });
    if (typeof m.poMatched === 'boolean') {
      // Worded from the findings (packages/api matchActivitySummary): PO state, loss, then what is left to review.
      const leakCount = typeof m.leakCount === 'number' ? m.leakCount : 0;
      const review = typeof m.reviewCount === 'number' ? m.reviewCount : 0;
      const lossText = ils(m.leakIls);
      const parts: Array<string | null> = [supplier];
      if (!m.poMatched) parts.push(m.pendingLink === true ? t('activity.awaitingPoLink') : t('activity.noPoLinked'));
      if (leakCount > 0) {
        parts.push(leakCount === 1 ? t('activity.discrepancyOne') : t('activity.discrepancies', { count: leakCount }));
        if (lossText) parts.push(t('activity.potentialLoss', { amount: lossText }));
      } else if (review > 0) {
        parts.push(review === 1 ? t('activity.toReviewOne') : t('activity.toReview', { count: review }));
      } else if (m.poMatched) {
        parts.push(t('activity.matchesOrder'));
      }
      return { title, detail: parts.filter(Boolean).join(' · ') || null };
    }
    // No PO yet: calm "waiting for a PO link", like the hero — never a loss figure.
    if (m.pendingLink === true) return { title, detail: [supplier, t('activity.awaitingPoLink')].filter(Boolean).join(' · ') };
    const hasLeak = typeof m.leakCount === 'number';
    const count = hasLeak ? (m.leakCount as number) : typeof m.discrepancyCount === 'number' ? m.discrepancyCount : null;
    const loss = ils(hasLeak ? m.leakIls : m.potentialLossIls);
    const parts =
      count === 0
        ? [supplier, t('activity.matchesOrder')]
        : [
            supplier,
            count === 1 ? t('activity.discrepancyOne') : count != null ? t('activity.discrepancies', { count }) : null,
            loss ? t('activity.potentialLoss', { amount: loss }) : null,
          ];
    return { title, detail: parts.filter(Boolean).join(' · ') || null };
  }
  return null;
}
