/**
 * Links for the AU-04 briefs: the branch-aware go-link (W1-04's
 * `/dashboard/go?r=<rid>&to=<path>`), and the PRE-ADDRESSED supplier drafts
 * (wa.me / mailto). The server never sends to a supplier: these open the
 * manager's own WhatsApp or mail client with the text filled in, and a human taps
 * send (AU README §4 rule 2).
 */

/** `baseUrl` without trailing slashes (a loop, not a regex: linear on any input). */
export function trimBase(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return baseUrl.slice(0, end);
}

/** `/dashboard/go?r=<rid>&to=<path>` on `baseUrl`. `to` must be an in-app path. */
export function goLink(baseUrl: string, restaurantId: string, to: string): string {
  const path = to.startsWith('/') ? to : `/${to}`;
  return `${trimBase(baseUrl)}/dashboard/go?r=${encodeURIComponent(restaurantId)}&to=${encodeURIComponent(path)}`;
}

/**
 * Interim Israeli phone → wa.me digits ("9725…"), until W2-11's E.164 normaliser
 * merges. Conservative on purpose: anything it cannot read with certainty is
 * `null`, and the brief then shows "no contact details" instead of a wrong link.
 * Accepts +972 / 972 / 00972 / a leading 0, with spaces, dashes, dots or brackets.
 */
export function waDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  let national: string;
  if (compact.startsWith('+972')) national = compact.slice(4);
  else if (compact.startsWith('00972')) national = compact.slice(5);
  else if (compact.startsWith('972')) national = compact.slice(3);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else return null;
  // "+972 05x…" typed by hand: one extra 0, only after a 972 prefix.
  if (national.startsWith('0') && compact.replace(/^\+|^00/, '').startsWith('972')) national = national.slice(1);
  // Mobile 5x + 7 digits (9); landlines 02/03/04/08/09 + 7 (8); 07x + 7 (9). Nothing else.
  if (!/^(5\d{8}|[2-489]\d{7}|7\d{8})$/.test(national)) return null;
  return `972${national}`;
}

/** `https://wa.me/<digits>?text=<text>`, or `null` when the number does not normalise. */
export function waMeLink(phone: string | null | undefined, text: string): string | null {
  const digits = waDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

/** One part of an address: no whitespace, no '@', none of <>()",;: (a single class: linear). */
const ADDRESS_PART = /^[^\s@<>()",;:]+$/;

/** A plausible address: exactly one '@', a dotted domain with no empty label at either end. */
function isEmail(to: string): boolean {
  const at = to.indexOf('@');
  if (at <= 0 || at !== to.lastIndexOf('@')) return false;
  const local = to.slice(0, at);
  const domain = to.slice(at + 1);
  const dot = domain.indexOf('.');
  if (dot <= 0 || domain.endsWith('.')) return false;
  return ADDRESS_PART.test(local) && ADDRESS_PART.test(domain);
}

/** `mailto:<address>?subject=&body=`, or `null` when the address is not one. */
export function mailtoLink(email: string | null | undefined, subject: string, body: string): string | null {
  const to = email?.trim();
  if (!to || !isEmail(to)) return null;
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
