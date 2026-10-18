/**
 * Sender normalisation for the allow-list. Both sides (stored allow-list entry
 * and incoming sender) go through the same function, so comparison is exact.
 */

/** `"Supplier" <Billing@Example.co.il>` → `billing@example.co.il`; null if not an address. */
export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // The REAL address is the LAST <...> — a display name may itself contain a
  // fake "<bills@supplier>" to spoof the allow-list.
  const angles = [...raw.matchAll(/<([^<>\s]+)>/g)];
  const candidate = (angles.length ? angles[angles.length - 1]![1]! : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) && candidate.length <= 254 ? candidate : null;
}

/**
 * Phone → E.164 digits without '+'. WhatsApp sends `972501234567`; owners type
 * `050-123-4567` or `+972 50 123 4567`. A leading 0 is read as an Israeli
 * national number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  if (/\D/.test(digits)) return null;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function normalizeSender(kind: 'whatsapp' | 'email', raw: string | null | undefined): string | null {
  return kind === 'email' ? normalizeEmailAddress(raw) : normalizePhone(raw);
}
