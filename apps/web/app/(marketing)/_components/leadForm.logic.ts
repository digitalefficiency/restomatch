/**
 * Pure rules behind the lead form (W1-12 · mkt-01, mkt-09, mkt-28). No React,
 * no DOM: the form, the attribution capture and the unit tests share them.
 *
 * The server contract (`leads.create`, immutable) still requires only `name`;
 * "phone OR e-mail" is enforced here, on the client. The matching server-side
 * `.refine` is a human-PR proposal (see the W1-12 PR body).
 */

/** Israeli numbers: +972 / 972 / 00972 → local 0…; spaces, dashes, dots and brackets dropped. */
export function normalizeIlPhone(raw: string): string {
  let d = raw.replace(/[\s\-().]/g, '');
  if (d.startsWith('+972')) d = `0${d.slice(4)}`;
  else if (d.startsWith('00972')) d = `0${d.slice(5)}`;
  else if (d.startsWith('972') && d.length >= 11) d = `0${d.slice(3)}`;
  return d;
}

/**
 * Valid Israeli phone: mobile 05X-XXXXXXX, VoIP 07X-XXXXXXX (10 digits), or a
 * landline 0[2-489]-XXXXXXX (9 digits).
 */
export function isValidIlPhone(raw: string): boolean {
  const d = normalizeIlPhone(raw);
  return /^0(5\d|7\d)\d{7}$/.test(d) || /^0[2-489]\d{7}$/.test(d);
}

/** Display/storage form: 050-1234567, 03-1234567. Unchanged when not a valid IL number. */
export function formatIlPhone(raw: string): string {
  const d = normalizeIlPhone(raw);
  if (/^0(5\d|7\d)\d{7}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (/^0[2-489]\d{7}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return raw.trim();
}

export function isValidEmail(raw: string): boolean {
  // Mirrors what zod's .email() accepts for everyday addresses; the server re-validates.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw.trim());
}

export type LeadFieldErrors = Partial<Record<'name' | 'phone' | 'email' | 'contact', LeadErrorKey>>;
export type LeadErrorKey = 'errorName' | 'errorPhone' | 'errorEmail' | 'errorContact';

/**
 * Field-level errors, keyed by field. `contact` (neither phone nor e-mail) is
 * shown under the phone field, which is the first of the two.
 */
export function validateLead(v: { name: string; phone: string; email: string }): LeadFieldErrors {
  const errors: LeadFieldErrors = {};
  if (!v.name.trim()) errors.name = 'errorName';
  const phone = v.phone.trim();
  const email = v.email.trim();
  if (phone && !isValidIlPhone(phone)) errors.phone = 'errorPhone';
  if (email && !isValidEmail(email)) errors.email = 'errorEmail';
  if (!phone && !email) errors.contact = 'errorContact';
  return errors;
}

/** Order in which focus goes to the first invalid field. */
export const LEAD_FIELD_ORDER = ['name', 'phone', 'email'] as const;
export function firstInvalidField(
  errors: LeadFieldErrors,
): (typeof LEAD_FIELD_ORDER)[number] | null {
  for (const f of LEAD_FIELD_ORDER) {
    if (errors[f] || (f === 'phone' && errors.contact)) return f;
  }
  return null;
}

// ─── Attribution (mkt-28) ────────────────────────────────────────────────────

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
export type Attribution = Partial<Record<(typeof UTM_KEYS)[number], string>> & {
  /** First page of the visit (path only). */
  entry?: string;
  /** Plan chosen on /pricing (`?plan=`). */
  plan?: string;
};

/** The router caps `source` at 120 characters. */
export const SOURCE_MAX = 120;

const SAFE = /[^\p{L}\p{N}_\-./]/gu;
function part(v: string | undefined, max: number): string {
  return (v ?? '').replace(SAFE, '').slice(0, max);
}

/**
 * Read UTM params and `plan` from a query string. Only non-empty, bounded
 * values are kept (they end up in a free-text DB column).
 */
export function attributionFromSearch(search: string, path: string): Attribution {
  const q = new URLSearchParams(search);
  const out: Attribution = {};
  for (const k of UTM_KEYS) {
    const v = part(q.get(k) ?? undefined, 40);
    if (v) out[k] = v;
  }
  const plan = part(q.get('plan') ?? undefined, 20);
  if (plan) out.plan = plan;
  const entry = part(path, 40);
  if (entry) out.entry = entry;
  return out;
}

/**
 * Merge a new landing into the stored attribution: fresh UTM params replace
 * the old campaign (last touch wins), the entry page is kept from the first
 * page of the visit, and a plan is kept until another is chosen.
 */
export function mergeAttribution(stored: Attribution | null, next: Attribution): Attribution {
  const hasUtm = UTM_KEYS.some((k) => next[k]);
  const base: Attribution = { ...(stored ?? {}) };
  if (hasUtm) for (const k of UTM_KEYS) delete base[k];
  // `next` only carries keys that had a value, so a stored plan survives a page without one.
  return { ...base, ...next, entry: stored?.entry ?? next.entry };
}

/**
 * `leads.create.source`: "<path>|<cta>|plan=…|src=…/…/…|in=<entry>", ≤120 chars.
 * The path is where the form was sent; `cta` names the form placement.
 */
export function buildLeadSource(path: string, cta: string, a: Attribution | null): string {
  const bits = [part(path, 40) || '/', part(cta, 20)];
  if (a?.plan) bits.push(`plan=${a.plan}`);
  const utm = [a?.utm_source, a?.utm_medium, a?.utm_campaign].filter(Boolean).join('/');
  if (utm) bits.push(`src=${utm}`);
  if (a?.entry && a.entry !== path) bits.push(`in=${a.entry}`);
  return bits.filter(Boolean).join('|').slice(0, SOURCE_MAX);
}

export const ATTRIBUTION_STORAGE_KEY = 'rm.attribution';
