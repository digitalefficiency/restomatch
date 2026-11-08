/**
 * W3-06 · the lead form's Server Action, as pure logic (no Next, no DB) so the
 * unit tests drive it with fakes. `leadAction.ts` wires the real deps.
 *
 * The action is the SAME front door as the tRPC route for `leads.create`:
 *   1. Origin must be this deployment (same check as the route's CSRF guard;
 *      Next.js also compares a Server Action's Origin with Host);
 *   2. the per-IP limit in the SAME bucket as the route
 *      (`{ limit: 10, windowSec: 3600, prefix: 'leads' }`, keyed by the
 *      trusted-hop client IP) — a test pins it to `app/api/trpc/[trpc]/route.ts`;
 *   3. every field is cut to the router's bounds BEFORE validation (no
 *      attacker-sized string ever reaches zod), then the client's rules run
 *      again server-side (name + a valid IL phone or e-mail);
 *   4. the unchanged, immutable `leads.create` contract does the insert
 *      (honeypot included: a filled `hp` is a silent success with no row).
 */
import type { RateLimitOptions } from '@restomatch/api';
import { formatIlPhone, validateLead, type LeadFieldErrors } from './leadForm.logic';

/** Mirrors `PER_PROCEDURE_LIMITS['leads.create']` in the (immutable) tRPC route. */
export const LEADS_RATE_LIMIT: RateLimitOptions = { limit: 10, windowSec: 60 * 60, prefix: 'leads' };

/** The router's own string bounds (`packages/api/src/routers/leads.ts`, immutable). */
export const LEAD_FIELD_MAX = {
  name: 200,
  phone: 32,
  email: 320,
  restaurantName: 200,
  monthly: 20,
  source: 120,
  consentText: 2000,
  hp: 200,
} as const;

/** The router caps agorot at 10^12. */
const MAX_AGOROT = 1_000_000_000_000;

export type LeadActionState =
  | { status: 'idle' }
  | { status: 'ok'; name: string; phone: string; email: string }
  | {
      status: 'invalid';
      errors: LeadFieldErrors;
      /** Everything the visitor typed or ticked, so a JS-off retry keeps it. */
      values: { name: string; phone: string; email: string; restaurantName: string; monthly: string; marketingConsent: boolean };
    }
  | { status: 'rate' }
  | { status: 'error' };

export const LEAD_IDLE: LeadActionState = { status: 'idle' };

/** Where a JS-off form POST lands (useActionState's permalink): the form's own anchor on the landing. */
export function leadFormPermalink(locale: string): string {
  return locale === 'en' ? '/?lang=en#lead' : '/#lead';
}

export interface LeadCreateInput {
  name: string;
  phone?: string;
  email?: string;
  restaurantName?: string;
  monthlyProcurementAgorot?: number;
  source?: string;
  marketingConsent: boolean;
  consentText?: string;
  hp?: string;
}

export interface LeadActionDeps {
  /** True when the request's Origin belongs to this deployment. */
  originOk: boolean;
  /** Per-IP limit (the `leads` bucket). */
  rateLimit: () => Promise<{ allowed: boolean }>;
  /** `leads.create` through the server caller. */
  create: (input: LeadCreateInput) => Promise<unknown>;
}

/** A bounded string field; a File or a missing field reads as ''. */
function field(fd: FormData, key: string, max: number): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** ₪ typed by a visitor ("120,000", "₪ 80 000") → integer agorot, or undefined. */
export function monthlyAgorotOf(raw: string): number | undefined {
  const ils = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(ils) || ils <= 0) return undefined;
  const agorot = Math.round(ils * 100);
  return agorot > MAX_AGOROT ? undefined : agorot;
}

export async function submitLead(fd: FormData, deps: LeadActionDeps): Promise<LeadActionState> {
  if (!deps.originOk) return { status: 'error' };

  const rl = await deps.rateLimit();
  if (!rl.allowed) return { status: 'rate' };

  const name = field(fd, 'name', LEAD_FIELD_MAX.name).trim();
  const phoneRaw = field(fd, 'phone', LEAD_FIELD_MAX.phone).trim();
  const email = field(fd, 'email', LEAD_FIELD_MAX.email).trim();
  const errors = validateLead({ name, phone: phoneRaw, email });
  if (Object.keys(errors).length > 0) {
    // Echo back only the bounded, already-typed fields so a JS-off retry keeps them.
    const restaurantName = field(fd, 'restaurantName', LEAD_FIELD_MAX.restaurantName);
    const monthly = field(fd, 'monthly', LEAD_FIELD_MAX.monthly);
    const marketingConsent = field(fd, 'marketingConsent', 8) === 'on';
    return { status: 'invalid', errors, values: { name, phone: phoneRaw, email, restaurantName, monthly, marketingConsent } };
  }

  const phone = phoneRaw ? formatIlPhone(phoneRaw) : '';
  const marketingConsent = field(fd, 'marketingConsent', 8) === 'on';
  const consentText = field(fd, 'consentText', LEAD_FIELD_MAX.consentText).trim();
  const restaurantName = field(fd, 'restaurantName', LEAD_FIELD_MAX.restaurantName).trim();
  const source = field(fd, 'source', LEAD_FIELD_MAX.source).trim();
  const hp = field(fd, 'hp', LEAD_FIELD_MAX.hp).trim();

  try {
    await deps.create({
      name,
      phone: phone || undefined,
      email: email || undefined,
      restaurantName: restaurantName || undefined,
      monthlyProcurementAgorot: monthlyAgorotOf(field(fd, 'monthly', LEAD_FIELD_MAX.monthly)),
      source: source || undefined,
      marketingConsent,
      consentText: marketingConsent && consentText ? consentText : undefined,
      hp: hp || undefined,
    });
  } catch {
    return { status: 'error' };
  }
  return { status: 'ok', name, phone, email };
}
