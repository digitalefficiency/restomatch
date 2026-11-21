/**
 * W2-11 · supplier field contracts, parsed once at the server boundary.
 *
 * Payment terms — the canonical strings W2-03's `computeDueDate` parses:
 *   "מזומן"        cash (due on the invoice date)
 *   "שוטף"         end of the invoice month
 *   "שוטף+N"       end of the invoice month + N days (no spaces, N = 1..365)
 * Anything else is free text ("אחר") and is stored as typed (trimmed); the due
 * date is then unknown, never guessed. The web form writes the same strings
 * (apps/web/app/dashboard/suppliers/terms.ts).
 */

const EOM = /^שוטף(?:\s*\+\s*(\d{1,3}))?$/;

/** Stored or typed terms → the canonical string; free text stays as typed; blank → null. */
export function canonicalPaymentTerms(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s === 'מזומן') return 'מזומן';
  const m = EOM.exec(s);
  if (m) {
    const n = m[1] ? Number(m[1]) : 0;
    return n > 0 ? `שוטף+${n}` : 'שוטף';
  }
  return s;
}

/**
 * An Israeli phone → E.164 ("050-123-4567" → "+972501234567"). Numbers already
 * in international form keep their country code. Text that isn't a phone number
 * (too few digits) is stored as typed, trimmed; blank → null.
 */
export function normalizeIsraeliPhone(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return s;
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('972')) return `+${digits}`;
  if (digits.startsWith('0')) return `+972${digits.slice(1)}`;
  return `+972${digits}`;
}

/**
 * Israeli company / business number (ח״פ / ע״מ / ת״ז): 9 digits with the check
 * digit (weights 1,2,1,2…, each product's digits summed; total mod 10 = 0).
 */
export function isValidBusinessId(raw: string | null | undefined): boolean {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    sum += p > 9 ? p - 9 : p;
  }
  return sum % 10 === 0;
}
