/**
 * Help, the accessibility statement and contact: the same links, in the same
 * place, on every dashboard route (ia-nav-20; sidebar spec §1.1 footer, §4.1).
 * One list for the side menu's help row, its rail tile and the phone sheet.
 * Pure data (no React, no icons): `icon` names a glyph in `UTILITY_ICONS`.
 */
export const SUPPORT_LINKS = [
  { key: 'help', href: '/accessibility#help', icon: 'help' }, // PLACEHOLDER until a help page exists (owner decision #3)
  { key: 'accessibility', href: '/accessibility', icon: 'accessibility' }, // the statement page itself (W1-12)
  { key: 'contact', href: '/accessibility#contact', icon: 'contact' }, // PLACEHOLDER until contact channels are set (owner decision #3)
] as const;

export type SupportLink = (typeof SUPPORT_LINKS)[number];
