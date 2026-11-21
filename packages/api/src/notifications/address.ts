/**
 * Typed delivery addresses (G-06, deep-fix class 14).
 *
 * The outbox dispatcher sends `notifications_outbox.target` verbatim as the
 * destination. A symbolic target like `role:manager` reached Meta as a WhatsApp
 * `to` and went nowhere. From here on a target is produced ONLY from a branded
 * `Address`, and an `Address` can only be built by a validating constructor:
 *
 *   - `emailAddress(raw)`              → a syntactically valid e-mail;
 *   - `verifiedPhone(raw, verifiedAt)` → an Israeli E.164 number (+972…) and only
 *                                        when the user's phone is VERIFIED;
 *   - `pushSubscriptionId(id)`         → none today (H-03 brings the table).
 *
 * `addressToTarget(a)` is the only way to the outbox `target` string, and a
 * runtime guard (`assertDeliverableTarget`) throws `INVALID_TARGET` on anything
 * that starts with `role:`.
 */

declare const ADDRESS_BRAND: unique symbol;
type Branded = { readonly [ADDRESS_BRAND]: true };

export type EmailAddress = Branded & { readonly channel: 'email'; readonly value: string };
/** E.164 digits without the '+', the form the WhatsApp Cloud API takes (e.g. 972525551234). */
export type VerifiedE164Phone = Branded & { readonly channel: 'whatsapp'; readonly value: string };
export type PushSubscriptionId = Branded & { readonly channel: 'push'; readonly value: string };

export type Address = EmailAddress | VerifiedE164Phone | PushSubscriptionId;
export type AddressChannel = Address['channel'];

export class InvalidTargetError extends Error {
  readonly code = 'INVALID_TARGET' as const;
  constructor(target: string) {
    super(`INVALID_TARGET: refusing to deliver to symbolic target "${target}"`);
    this.name = 'InvalidTargetError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function brand<A extends Address>(channel: A['channel'], value: string): A {
  return Object.freeze({ channel, value }) as unknown as A;
}

/** A valid e-mail (trimmed, lower-cased domain kept as typed) or null. Never a `role:` string. */
export function emailAddress(raw: string | null | undefined): EmailAddress | null {
  const v = raw?.trim() ?? '';
  if (!v || v.toLowerCase().startsWith('role:') || !EMAIL_RE.test(v)) return null;
  return brand<EmailAddress>('email', v);
}

/** Normalise an Israeli number to E.164 digits (972 + 8–9 digits), or null. */
export function normalizeIsraeliPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return /^972\d{8,9}$/.test(d) ? d : null;
}

/**
 * A WhatsApp address for a USER: only once the phone is verified
 * (`users.phone_verified_at`, G-03 + W2-14's OTP). Until then every caller
 * passes null and no user is reachable on WhatsApp — honestly.
 */
export function verifiedPhone(
  raw: string | null | undefined,
  phoneVerifiedAt: Date | string | null | undefined,
): VerifiedE164Phone | null {
  if (!phoneVerifiedAt) return null;
  const d = normalizeIsraeliPhone(raw);
  return d ? brand<VerifiedE164Phone>('whatsapp', d) : null;
}

/** Push subscriptions arrive with H-03's table. None exist today. */
export const PUSH_SUBSCRIPTIONS_AVAILABLE = false;
export function pushSubscriptionId(id: string | null | undefined): PushSubscriptionId | null {
  if (!PUSH_SUBSCRIPTIONS_AVAILABLE || !id) return null;
  return brand<PushSubscriptionId>('push', id);
}

/**
 * A SUPPLIER's address (not a user: there is no verification step; the
 * restaurant typed it). This is the `addressOf(supplier, channel)` W2-06's
 * interim `supplierAddress()` swaps to: same rules (WhatsApp → E.164 digits,
 * e-mail → valid syntax, a `role:` value → null).
 */
export function supplierAddressOf(
  supplier: { email: string | null; whatsapp: string | null } | null | undefined,
  channel: 'email' | 'whatsapp',
): EmailAddress | VerifiedE164Phone | null {
  if (!supplier) return null;
  if (channel === 'email') return emailAddress(supplier.email);
  const raw = supplier.whatsapp?.trim() ?? '';
  if (!raw || raw.toLowerCase().startsWith('role:')) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  if (/\D/.test(d) || d.length < 8 || d.length > 15) return null;
  return brand<VerifiedE164Phone>('whatsapp', d);
}

/** Throws INVALID_TARGET for a symbolic `role:` target (or an empty one). */
export function assertDeliverableTarget(target: string): string {
  if (!target || target.trim().toLowerCase().startsWith('role:')) throw new InvalidTargetError(target);
  return target;
}

/** The ONLY path from an address to an outbox `target`. */
export function addressToTarget(a: Address): string {
  return assertDeliverableTarget(a.value);
}
