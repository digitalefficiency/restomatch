/**
 * W2-11 · the structured payment-terms picker. It writes ONLY the canonical
 * strings W2-03's `computeDueDate` parses (packages/api/src/lib/dueDate.ts) and
 * the server re-canonicalises on save (ledger/supplierFields.ts):
 *   "מזומן" · "שוטף" · "שוטף+N"
 * "אחר" keeps free text as typed; its due date is then unknown, never guessed.
 */

export type TermsChoice = 'cash' | 'eom' | 'eom30' | 'eom45' | 'eom60' | 'eom90' | 'eomN' | 'other' | 'none';

export const TERMS_CHOICES: readonly TermsChoice[] = ['cash', 'eom', 'eom30', 'eom45', 'eom60', 'eom90', 'eomN', 'other'];

const PRESET_DAYS: Partial<Record<TermsChoice, number>> = { eom30: 30, eom45: 45, eom60: 60, eom90: 90 };

/**
 * Payment-Delays law ceiling (days after the end of the invoice month).
 * TODO(W2-03): import `PAYMENT_LAW_MAX_DAYS_AFTER_EOM` from lib/dueDate.ts once
 * it is on the base — interim mirror of the same value (45).
 */
export const PAYMENT_LAW_MAX_DAYS_AFTER_EOM = 45;

export interface TermsValue {
  choice: TermsChoice;
  /** Days after end of month for `eomN`. */
  days: string;
  /** Free text for `other`. */
  text: string;
}

const EOM = /^שוטף(?:\s*\+\s*(\d{1,3}))?$/;

/** A stored terms string → the picker state. Unknown text opens as "אחר" with the text kept. */
export function termsValueOf(raw: string | null | undefined): TermsValue {
  const s = raw?.trim() ?? '';
  if (!s) return { choice: 'none', days: '', text: '' };
  if (s === 'מזומן') return { choice: 'cash', days: '', text: '' };
  const m = EOM.exec(s);
  if (m) {
    const n = m[1] ? Number(m[1]) : 0;
    if (n === 0) return { choice: 'eom', days: '', text: '' };
    const preset = (Object.keys(PRESET_DAYS) as TermsChoice[]).find((k) => PRESET_DAYS[k] === n);
    return preset ? { choice: preset, days: '', text: '' } : { choice: 'eomN', days: String(n), text: '' };
  }
  return { choice: 'other', days: '', text: s };
}

/** The picker state → the canonical string to save ('' = no terms). */
export function termsStringOf(v: TermsValue): string {
  switch (v.choice) {
    case 'none':
      return '';
    case 'cash':
      return 'מזומן';
    case 'eom':
      return 'שוטף';
    case 'eomN': {
      const n = Number(v.days.replace(/\D/g, ''));
      return Number.isInteger(n) && n > 0 && n <= 365 ? `שוטף+${n}` : '';
    }
    case 'other':
      return v.text.trim();
    default:
      return `שוטף+${PRESET_DAYS[v.choice]}`;
  }
}

/** Days after end of month the terms imply, or null for cash / free text / none. */
export function eomDaysOf(v: TermsValue): number | null {
  const s = termsStringOf(v);
  const m = EOM.exec(s);
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

/** Terms past the Payment-Delays law ceiling get the warning "מעבר לתקרת החוק". */
export function exceedsLawLimit(v: TermsValue): boolean {
  const d = eomDaysOf(v);
  return d !== null && d > PAYMENT_LAW_MAX_DAYS_AFTER_EOM;
}

/** What blocks saving the picker, or null. */
export function termsProblem(v: TermsValue): 'pickDays' | 'typeTerms' | null {
  if (v.choice === 'eomN' && termsStringOf(v) === '') return 'pickDays';
  if (v.choice === 'other' && !v.text.trim()) return 'typeTerms';
  return null;
}

/**
 * Israeli company / business number (ח״פ): 9 digits with the check digit
 * (weights 1,2,1,2…, each product's digits summed; total mod 10 = 0).
 * Mirrors the server's `isValidBusinessId` (ledger/supplierFields.ts).
 */
export function businessIdProblem(raw: string): 'bizLength' | 'bizCheck' | null {
  const d = raw.replace(/\D/g, '');
  if (!raw.trim()) return null;
  if (d.length !== 9) return 'bizLength';
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return sum % 10 === 0 ? null : 'bizCheck';
}

/** tel: href in international form (the number is stored as E.164 since W2-11). */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `tel:+${intl}`;
}
