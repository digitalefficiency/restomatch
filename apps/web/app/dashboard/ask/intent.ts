/**
 * The interpreted-intent chip (W3-04b, independent of AU-06): above each
 * answer, one short line saying how the question was understood, plus "לא זו
 * השאלה?", which reopens the composer with the question for rephrasing. The
 * server returns the structured intent; this file only turns it into the chip
 * text, so the wording lives in one place. No ₪ here: amounts come from the
 * engine in the answer itself, never from the intent.
 */

export type IntentTopic =
  | 'leak'
  | 'prices'
  | 'supplier'
  | 'invoice'
  | 'claims'
  | 'approvals'
  | 'orders'
  | 'other';

export interface InterpretedIntent {
  topic: IntentTopic;
  /** A supplier / product / invoice name as the server resolved it. */
  subject?: string | null;
  /** Period as `YYYY-MM` (a month) or null for "now". */
  period?: string | null;
}

const TOPIC: Record<'he' | 'en', Record<IntentTopic, string>> = {
  he: {
    leak: 'דליפה',
    prices: 'מחירים שעלו',
    supplier: 'ספק',
    invoice: 'חשבונית',
    claims: 'בקשות זיכוי',
    approvals: 'פערים להחלטה',
    orders: 'הזמנות',
    other: 'שאלה כללית',
  },
  en: {
    leak: 'Leak',
    prices: 'Price increases',
    supplier: 'Supplier',
    invoice: 'Invoice',
    claims: 'Credit requests',
    approvals: 'Discrepancies to decide',
    orders: 'Orders',
    other: 'General question',
  },
};

export const intentCopy = {
  he: { understood: 'הבנתי:', notThis: 'לא זו השאלה?' },
  en: { understood: 'Understood as:', notThis: 'Not your question?' },
} as const;

/** "10.2026" for "2026-10"; null for a missing or malformed period. */
export function formatPeriod(period: string | null | undefined): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period ?? '');
  return m ? `${Number(m[2])}.${m[1]}` : null;
}

/** The chip text, e.g. "הבנתי: דליפה · 10.2026" or "הבנתי: ספק · ירקות השרון". */
export function intentChip(intent: InterpretedIntent, locale: 'he' | 'en'): string {
  const parts = [TOPIC[locale][intent.topic] ?? TOPIC[locale].other];
  const subject = intent.subject?.trim();
  if (subject) parts.push(subject);
  const period = formatPeriod(intent.period);
  if (period) parts.push(period);
  return `${intentCopy[locale].understood} ${parts.join(' · ')}`;
}
