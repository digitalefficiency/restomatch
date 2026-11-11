import type { AppLocale } from '@/lib/i18n/config';
import { createTranslator } from '@/lib/i18n/translate';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { recovery } from '@/lib/i18n/messages/recovery';
import { formatIls } from '@/lib/money';
import { lineMath, type LetterLine } from './letters';

/**
 * One letter line's basis in the supplier's words (W2-10 acceptance 4, owner
 * 7.11: the invoice is the subject, never "חויבנו"): "בחשבונית 10 × ₪149.00 ·
 * בהזמנה ₪139.00 (הזמנה PO-17, 12.10.2026) = ₪100.00". "בהזמנה" only when the
 * invoice matched an order; otherwise the usual price (p90). Display only —
 * the ₪ asked is the claim's, never recomputed here.
 * TODO(W2-09b): build from `whySegments` once flags/why.ts lands.
 */
export function letterLineText(
  l: Pick<LetterLine, 'type' | 'expected' | 'actual' | 'deltaAmount' | 'invoiceDate' | 'amount'> & {
    severity?: string | null;
    poRef?: string | null;
  },
  locale: AppLocale,
): string | null {
  const m = lineMath(l);
  if (!m) return null;
  const t = createTranslator(locale, recovery);
  const base = t.locale;
  const ils = (v: number) => formatIls(v, { locale: base, maximumFractionDigits: 2 });
  const num = (v: number) => formatNumber(v, base, { maximumFractionDigits: 3 });
  const ref = l.poRef
    ? t('letter.ref', { po: l.poRef, date: l.invoiceDate ? formatDate(l.invoiceDate, base) : '—' })
    : '';
  const body = (() => {
    switch (m.kind) {
      case 'price':
        return l.poRef
          ? t('letter.priceOrder', { qty: num(m.qty), charged: ils(m.charged), expected: ils(m.expected) })
          : t('letter.priceUsual', { qty: num(m.qty), charged: ils(m.charged), expected: ils(m.expected) });
      case 'qty':
        return t('letter.qty', { billed: num(m.billed), received: num(m.received), price: ils(m.unitPrice) });
      case 'qtyReceived':
        return t('letter.qtyReceived', { ordered: num(m.ordered), received: num(m.received), price: ils(m.unitPrice) });
      case 'vat':
        return t('letter.vat', { charged: ils(m.charged), expected: ils(m.expected) });
      case 'total':
        return t('letter.total', { charged: ils(m.charged), expected: ils(m.expected) });
      case 'unordered':
        return t('letter.unordered', { qty: num(m.qty) });
    }
  })();
  return t('letter.line', { body, ref, amount: ils(l.amount) });
}
