/**
 * The legal-link registry (G-11 · deep-fix class 15, fix #2): the ONE ordered
 * list of legal links that every shell renders — marketing, legal pages, sign-in,
 * the supplier portal, the showcase, admin and both error boundaries — plus the
 * sitemap and the robots `allow` list, which derive from it.
 *
 * ZERO IMPORTS on purpose: `app/global-error.tsx` renders outside every provider
 * and must load this file even when other chunks failed. Keep it that way
 * (`__tests__/registry.test.ts` reads the source and fails on any `import`).
 *
 * NOT a security list. `lib/publicPaths.ts` stays the middleware's authoritative
 * allow-list and is never derived from here ("has a footer link" must not mean
 * "open to anyone"); the test only asserts that every page here is a subset of it.
 *
 * The required set (statement, privacy, terms, cookies) is pinned separately in
 * `__tests__/required-set.test.ts`, which does not read this file's list.
 */

/** Label in both base locales; parity is enforced by the type. */
export type Localized = { he: string; en: string };

export type LegalLinkId = 'accessibility' | 'privacy' | 'terms' | 'cookies' | 'cookieSettings';

export type LegalLink = {
  id: LegalLinkId;
  href: string;
  label: Localized;
  /**
   * `page`: a public document (sitemap + robots). `action`: opens a control —
   * `cookieSettings` is intercepted by the consent UI (H-02) to open the sheet;
   * until then it lands on the cookie policy's settings anchor.
   */
  kind: 'page' | 'action';
};

/** The fixed order every shell shows. Variants change layout only, never this. */
export const LEGAL_LINKS: readonly LegalLink[] = [
  {
    id: 'accessibility',
    href: '/accessibility',
    label: { he: 'הצהרת נגישות', en: 'Accessibility statement' },
    kind: 'page',
  },
  { id: 'privacy', href: '/privacy', label: { he: 'מדיניות פרטיות', en: 'Privacy policy' }, kind: 'page' },
  { id: 'terms', href: '/terms', label: { he: 'תנאי שימוש', en: 'Terms of use' }, kind: 'page' },
  { id: 'cookies', href: '/cookies', label: { he: 'מדיניות עוגיות', en: 'Cookie policy' }, kind: 'page' },
  {
    id: 'cookieSettings',
    href: '/cookies#cookie-settings',
    label: { he: 'הגדרות עוגיות', en: 'Cookie settings' },
    kind: 'action',
  },
];

/** Accessible name for a stand-alone legal `<nav>` (shells with no footer copy of their own). */
export const LEGAL_NAV_LABEL: Localized = { he: 'קישורים משפטיים', en: 'Legal links' };

/** The document routes (no hash, no actions): what the sitemap and robots list. */
export const LEGAL_PAGE_PATHS: readonly string[] = LEGAL_LINKS.filter((l) => l.kind === 'page').map(
  (l) => l.href.split('#')[0]!,
);

export type SupportLinkId = 'help' | 'contact';

/**
 * Help and contact, for the signed-in footer (W2-08 adopts these; WCAG 3.2.6
 * consistent help). PLACEHOLDER targets until a help page exists (owner decision #3).
 */
export const SUPPORT_LINKS: readonly { id: SupportLinkId; href: string; label: Localized }[] = [
  { id: 'help', href: '/accessibility#help', label: { he: 'עזרה', en: 'Help' } },
  { id: 'contact', href: '/accessibility#contact', label: { he: 'יצירת קשר', en: 'Contact' } },
];

/** The href for a legal link — use this instead of a literal `/privacy` in copy. */
export function legalHref(id: LegalLinkId): string {
  const link = LEGAL_LINKS.find((l) => l.id === id);
  if (!link) throw new Error(`unknown legal link: ${id}`);
  return link.href;
}
