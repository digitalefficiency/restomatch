/**
 * Public contact channels for the marketing site, the showcase and the
 * accessibility statement (W1-12 · mkt-06).
 *
 * Every channel is OPTIONAL and comes from env, so the site never shows a
 * channel nobody answers: a link renders only when its value is set, and copy
 * that mentions a channel ("או כתבו לנו בוואטסאפ") is chosen from what exists.
 * The values are NEXT_PUBLIC_* because the lead form, the sticky bar and the
 * mobile menu are client components; they are inlined at build time.
 *
 * The owner supplies (REVIEW-REPORT.he.md §8, items 1 and 3):
 *   NEXT_PUBLIC_CONTACT_WHATSAPP    — WhatsApp number, any format (050-1234567 / +972501234567)
 *   NEXT_PUBLIC_CONTACT_PHONE       — phone number shown and dialled
 *   NEXT_PUBLIC_CONTACT_EMAIL       — public contact e-mail
 *   NEXT_PUBLIC_A11Y_COORDINATOR_NAME / _PHONE / _EMAIL — the accessibility coordinator
 */

export type ContactChannels = {
  whatsapp: { display: string; digits: string } | null;
  phone: { display: string; href: string } | null;
  email: { address: string; href: string } | null;
};

export type ContactEnv = Partial<Record<string, string | undefined>>;

function clean(v: string | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/**
 * International digits for wa.me / tel: links. Israeli local numbers
 * (leading 0) become 972…; a leading + or 00 is dropped. Null when the value
 * holds too few digits to be a phone number.
 */
export function internationalDigits(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `972${d.slice(1)}`;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

/** Plain e-mail shape check (the address is configured by the owner, not typed by visitors). */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Read the channels. `env` is injectable for tests; the default reads each
 * NEXT_PUBLIC_* key literally so Next can inline it into client bundles.
 */
export function contactChannels(env?: ContactEnv): ContactChannels {
  const e = env ?? {
    NEXT_PUBLIC_CONTACT_WHATSAPP: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP,
    NEXT_PUBLIC_CONTACT_PHONE: process.env.NEXT_PUBLIC_CONTACT_PHONE,
    NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  };
  const wa = clean(e.NEXT_PUBLIC_CONTACT_WHATSAPP);
  const waDigits = wa ? internationalDigits(wa) : null;
  const phone = clean(e.NEXT_PUBLIC_CONTACT_PHONE);
  const phoneDigits = phone ? internationalDigits(phone) : null;
  const email = clean(e.NEXT_PUBLIC_CONTACT_EMAIL);
  return {
    whatsapp: wa && waDigits ? { display: wa, digits: waDigits } : null,
    phone: phone && phoneDigits ? { display: phone, href: `tel:+${phoneDigits}` } : null,
    email: email && looksLikeEmail(email) ? { address: email, href: `mailto:${email}` } : null,
  };
}

/** Click-to-chat link with a prefilled message (wa.me accepts digits only). */
export function whatsappHref(digits: string, text?: string): string {
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function hasAnyChannel(c: ContactChannels): boolean {
  return Boolean(c.whatsapp || c.phone || c.email);
}

export type A11yCoordinator = { name: string | null; phone: string | null; email: string | null };

/** The accessibility coordinator (reg. 35). Null fields render as marked placeholders. */
export function accessibilityCoordinator(env?: ContactEnv): A11yCoordinator {
  const e = env ?? {
    NEXT_PUBLIC_A11Y_COORDINATOR_NAME: process.env.NEXT_PUBLIC_A11Y_COORDINATOR_NAME,
    NEXT_PUBLIC_A11Y_COORDINATOR_PHONE: process.env.NEXT_PUBLIC_A11Y_COORDINATOR_PHONE,
    NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL: process.env.NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL,
  };
  return {
    name: clean(e.NEXT_PUBLIC_A11Y_COORDINATOR_NAME),
    phone: clean(e.NEXT_PUBLIC_A11Y_COORDINATOR_PHONE),
    email: clean(e.NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL),
  };
}
