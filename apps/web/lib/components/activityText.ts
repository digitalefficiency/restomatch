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
  item: { eventType: string; title: string; detail: string | null },
  locale: Locale,
): { title: string; detail: string | null } {
  if (locale === 'he') return { title: item.title, detail: item.detail };
  const t = createTranslator(locale, components);

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
