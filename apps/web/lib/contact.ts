/**
 * THE one place for owner-supplied public facts (W1-12 · mkt-06, a11y-01):
 * the accessibility coordinator, the company's legal details and the public
 * contact channels. Owner decisions: REVIEW-REPORT.he.md §8 items 1–3.
 *
 * `null` = still pending from the owner. Pending facts are never invented:
 *   - contact channels that are pending are simply not rendered (no dead link,
 *     no copy that points to a channel nobody answers);
 *   - statement facts that are pending render as a visibly marked placeholder
 *     ("[טלפון רכז/ת הנגישות]"), and `assertStatementPublishable()` stops a
 *     PRODUCTION deploy from shipping the statement with any of them.
 *
 * To fill a fact, edit PUBLIC_FACTS below (or set the matching NEXT_PUBLIC_*
 * env var on the deployment, which wins over the constant). The values are
 * NEXT_PUBLIC_* because the lead form, the sticky bar and the mobile menu are
 * client components; they are inlined at build time.
 */

type Localized = { he: string; en: string };

export const PUBLIC_FACTS: {
  a11yCoordinator: { name: Localized | null; phone: string | null; email: string | null };
  company: {
    legalName: Localized | null;
    /** ח״פ */
    companyId: string | null;
    address: Localized | null;
    privacyContact: string | null;
  };
  channels: { whatsapp: string | null; phone: string | null; email: string | null };
} = {
  a11yCoordinator: {
    name: { he: 'רום קורן', en: 'Rom Koren' },
    phone: '054-3544245', // owner-confirmed 2026-10-31
    email: 'info@digitalefficiency.co.il', // owner-confirmed 2026-10-31
  },
  company: {
    legalName: null, // pending from the owner
    companyId: null, // pending from the owner
    address: null, // pending from the owner
    privacyContact: null, // pending from the owner (legal text signing is H-02)
  },
  channels: {
    whatsapp: '054-3544245', // owner-confirmed 2026-10-31
    phone: '054-3544245', // owner-confirmed 2026-10-31
    email: 'info@digitalefficiency.co.il', // owner-confirmed 2026-10-31
  },
};

export type ContactChannels = {
  whatsapp: { display: string; digits: string } | null;
  phone: { display: string; href: string } | null;
  email: { address: string; href: string } | null;
};

export type ContactEnv = Partial<Record<string, string | undefined>>;

function clean(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/** Reads each NEXT_PUBLIC_* key literally so Next can inline it into client bundles. */
function deployEnv(): ContactEnv {
  return {
    NEXT_PUBLIC_CONTACT_WHATSAPP: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP,
    NEXT_PUBLIC_CONTACT_PHONE: process.env.NEXT_PUBLIC_CONTACT_PHONE,
    NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
    NEXT_PUBLIC_A11Y_COORDINATOR_PHONE: process.env.NEXT_PUBLIC_A11Y_COORDINATOR_PHONE,
    NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL: process.env.NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL,
  };
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
 * The public contact channels. `env` and `facts` are injectable for tests; by
 * default the deployment env wins over PUBLIC_FACTS. A malformed value counts
 * as not configured.
 */
export function contactChannels(
  env: ContactEnv = deployEnv(),
  facts = PUBLIC_FACTS,
): ContactChannels {
  const wa = clean(env.NEXT_PUBLIC_CONTACT_WHATSAPP) ?? clean(facts.channels.whatsapp);
  const waDigits = wa ? internationalDigits(wa) : null;
  const phone = clean(env.NEXT_PUBLIC_CONTACT_PHONE) ?? clean(facts.channels.phone);
  const phoneDigits = phone ? internationalDigits(phone) : null;
  const email = clean(env.NEXT_PUBLIC_CONTACT_EMAIL) ?? clean(facts.channels.email);
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

export type A11yCoordinator = {
  name: Localized | null;
  phone: string | null;
  email: string | null;
};

/** The accessibility coordinator (reg. 35). Null fields render as marked placeholders. */
export function accessibilityCoordinator(
  env: ContactEnv = deployEnv(),
  facts = PUBLIC_FACTS,
): A11yCoordinator {
  return {
    name: facts.a11yCoordinator.name,
    phone: clean(env.NEXT_PUBLIC_A11Y_COORDINATOR_PHONE) ?? clean(facts.a11yCoordinator.phone),
    email: clean(env.NEXT_PUBLIC_A11Y_COORDINATOR_EMAIL) ?? clean(facts.a11yCoordinator.email),
  };
}

/** The operator named on the statement: legal name + ח״פ. */
export function companyDetails(facts = PUBLIC_FACTS) {
  return { legalName: facts.company.legalName, companyId: clean(facts.company.companyId) };
}

/** Facts the accessibility statement shows that are still placeholders. */
export function pendingStatementFacts(
  env: ContactEnv = deployEnv(),
  facts = PUBLIC_FACTS,
): string[] {
  const c = accessibilityCoordinator(env, facts);
  const co = companyDetails(facts);
  const pending: string[] = [];
  if (!c.name) pending.push('a11yCoordinator.name');
  if (!c.phone) pending.push('a11yCoordinator.phone');
  if (!c.email) pending.push('a11yCoordinator.email');
  if (!co.legalName) pending.push('company.legalName');
  if (!co.companyId) pending.push('company.companyId');
  return pending;
}

/**
 * Release guard: the accessibility statement must not reach PRODUCTION with a
 * placeholder in it (reg. 35 needs a real coordinator and operator). Throws on
 * a production deployment (Vercel `VERCEL_ENV=production`, evaluated when the
 * page module loads during `next build`), so the deploy fails instead of
 * publishing "[טלפון רכז/ת הנגישות]". Previews and local builds are allowed.
 */
export function assertStatementPublishable(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
  env: ContactEnv = deployEnv(),
  facts = PUBLIC_FACTS,
): void {
  if (vercelEnv !== 'production') return;
  const pending = pendingStatementFacts(env, facts);
  if (pending.length > 0) {
    throw new Error(
      `[accessibility statement] refusing to ship to production with placeholders: ${pending.join(', ')}. ` +
        'Fill them in apps/web/lib/contact.ts (PUBLIC_FACTS) or the NEXT_PUBLIC_A11Y_COORDINATOR_* env vars.',
    );
  }
}
