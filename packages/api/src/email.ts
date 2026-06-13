/**
 * Canonicalize an email address into a stable mailbox key for rate limiting.
 *
 * Sub-addressing (`user+tag@gmail.com`) and Gmail dot-insensitivity
 * (`u.s.er@gmail.com`) all deliver to the same inbox, so they must collapse to
 * one key — otherwise a per-email magic-link limit is trivially multiplied by
 * cycling aliases to bomb a single inbox. Use this ONLY for the limiter key;
 * always send mail to the address the user actually typed.
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function canonicalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed; // not an address shape — key on it as-is

  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  // Strip sub-address tag for every provider.
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  // Gmail ignores dots in the local part and treats googlemail as gmail.
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}
