import type { AppLocale } from '@/lib/i18n/config';
import { createTranslator } from '@/lib/i18n/translate';
import { formatNumber } from '@/lib/i18n/format';
import { leaks } from '@/lib/i18n/messages/leaks';
import { formatIls } from '@/lib/money';
import { lineMath, type LetterLine } from './letters';

/**
 * A claim line's ₪ basis in words — "חויב 10 × ₪149.00 · מחיר צפוי ₪139.00" —
 * shared by the claim letters and the supplier leak card (display only; the
 * claimed amount is never recomputed). null when the engine left no basis.
 */
export function lineMathText(
  l: Pick<LetterLine, 'type' | 'expected' | 'actual' | 'deltaAmount'> & { severity?: string | null },
  locale: AppLocale,
): string | null {
  const m = lineMath(l);
  if (!m) return null;
  const t = createTranslator(locale, leaks);
  const base = t.locale;
  const ils = (v: number) => formatIls(v, { locale: base, maximumFractionDigits: 2 });
  const num = (v: number) => formatNumber(v, base, { maximumFractionDigits: 3 });
  switch (m.kind) {
    case 'price':
      return t('claims.math.price', { qty: num(m.qty), charged: ils(m.charged), expected: ils(m.expected) });
    case 'qty':
      return t('claims.math.qty', { billed: num(m.billed), received: num(m.received), price: ils(m.unitPrice) });
    case 'qtyReceived':
      return t('claims.math.qtyReceived', { ordered: num(m.ordered), received: num(m.received), price: ils(m.unitPrice) });
    case 'vat':
      return t('claims.math.vat', { charged: ils(m.charged), expected: ils(m.expected) });
    case 'total':
      return t('claims.math.total', { charged: ils(m.charged), expected: ils(m.expected) });
    case 'unordered':
      return t('claims.math.unordered', { qty: num(m.qty) });
  }
}
