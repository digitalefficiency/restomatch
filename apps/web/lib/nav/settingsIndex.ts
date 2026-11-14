import type { UserRole } from '@restomatch/db';
import { en as automationsEn } from '../i18n/messages/automations/en';
import { he as automationsHe } from '../i18n/messages/automations/he';
import { en as settingsEn } from '../i18n/messages/settings/en';
import { he as settingsHe } from '../i18n/messages/settings/he';

/**
 * The palette's "הגדרות" section until DS3-06 ships its own list: every real
 * section of app/dashboard/settings/** a role can reach. Labels come from the
 * settings page's own messages (so the palette names a section exactly as its
 * heading does), and `roles` mirrors how page.tsx gates each section, so the
 * palette never offers a section the page will not render for that role.
 *
 * Hrefs: the page has ONE section anchor today, `id="letterhead"` (page.tsx,
 * also linked from the claims page); every other section opens the page top.
 * When DS3-06 gives the sections ids, point the entries at them here.
 *
 * Left out on purpose: the referral card ("חבר מביא חבר", ReferralCard) shows
 * only with the `growth` flag, and an entry carries no flag, so it could lead
 * to a page without the card.
 */

/** One palette "הגדרות" option: where it lands, what it is called, and who may see it. */
export interface SettingEntry {
  /** Stable id (palette option key). Unique. */
  id: string;
  /** Always under /dashboard/settings; an anchor only where the id exists in the page. */
  href: string;
  label: { he: string; en: string };
  /** Extra search words in both languages (the label always matches). */
  keywords: readonly string[];
  /** Roles that see the section; omitted = every role (personal sections). */
  roles?: readonly UserRole[];
}

const SETTINGS_HREF = '/dashboard/settings';

/** page.tsx `seesRestaurant`: the restaurant sections are owner-edit, manager + bookkeeper read, hidden for chef + receiver. */
const RESTAURANT_READERS: readonly UserRole[] = ['owner', 'manager', 'bookkeeper'];

/** In page order (account → privacy), then the automations sub-page. */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  {
    id: 'account',
    href: SETTINGS_HREF,
    label: { he: settingsHe.sections.accountTitle, en: settingsEn.sections.accountTitle },
    keywords: [
      settingsHe.account.languageTitle,
      settingsEn.account.languageTitle,
      settingsHe.account.passwordTitle,
      settingsEn.account.passwordTitle,
      settingsHe.account.devicesTitle,
      settingsEn.account.devicesTitle,
      settingsHe.account.he,
      settingsEn.account.he,
      settingsHe.account.en,
      'שפה',
      'language',
      'התנתקות',
      'sign out',
    ],
  },
  {
    id: 'security',
    href: SETTINGS_HREF,
    label: { he: settingsHe.sections.securityTitle, en: settingsEn.sections.securityTitle },
    keywords: [settingsHe.twoFactor.title, settingsEn.twoFactor.title, '2FA', 'קודי שחזור', 'recovery codes', 'authenticator'],
  },
  {
    id: 'phone',
    href: SETTINGS_HREF,
    label: { he: settingsHe.phone.title, en: settingsEn.phone.title },
    keywords: [settingsHe.phone.label, settingsEn.phone.label, 'וואטסאפ', 'WhatsApp'],
  },
  {
    id: 'profile',
    href: SETTINGS_HREF,
    label: { he: settingsHe.sections.profileTitle, en: settingsEn.sections.profileTitle },
    keywords: [
      settingsHe.profile.name,
      settingsEn.profile.name,
      settingsHe.profile.businessId,
      settingsEn.profile.businessId,
      settingsHe.profile.vat,
      settingsEn.profile.vat,
      settingsHe.profile.timezone,
      settingsEn.profile.timezone,
      'מע״מ',
      'ח״פ',
      'VAT',
    ],
    roles: RESTAURANT_READERS,
  },
  {
    id: 'letterhead',
    href: `${SETTINGS_HREF}#letterhead`,
    label: { he: settingsHe.sections.letterheadTitle, en: settingsEn.sections.letterheadTitle },
    keywords: [settingsHe.letterhead.cardTitle, settingsEn.letterhead.cardTitle, 'בקשת זיכוי', 'מכתב', 'credit request', 'letter'],
    roles: RESTAURANT_READERS,
  },
  {
    id: 'rules',
    href: SETTINGS_HREF,
    label: { he: settingsHe.rules.title, en: settingsEn.rules.title },
    keywords: [
      settingsHe.rules.approvalsTitle,
      settingsEn.rules.approvalsTitle,
      settingsHe.rules.tolerancesTitle,
      settingsEn.rules.tolerancesTitle,
      'היסטוריית שינויים',
      'change history',
    ],
    roles: RESTAURANT_READERS,
  },
  {
    id: 'matching',
    href: SETTINGS_HREF,
    label: { he: settingsHe.sections.matchingTitle, en: settingsEn.sections.matchingTitle },
    keywords: [
      settingsHe.matching.tolerancesTitle,
      settingsEn.matching.tolerancesTitle,
      settingsHe.matching.approvalsTitle,
      settingsEn.matching.approvalsTitle,
      settingsHe.matching.ocrTitle,
      settingsEn.matching.ocrTitle,
      'OCR',
    ],
    roles: RESTAURANT_READERS,
  },
  {
    id: 'privacy',
    href: SETTINGS_HREF,
    label: { he: settingsHe.sections.privacyTitle, en: settingsEn.sections.privacyTitle },
    keywords: [settingsHe.dsr.export, settingsEn.dsr.export, settingsHe.dsr.delete, settingsEn.dsr.delete, 'פרטיות', 'privacy'],
  },
  {
    // AU-01: owner edits, manager + bookkeeper read (the page's READERS and the
    // registry gate on /dashboard/settings/automations agree).
    id: 'automations',
    href: `${SETTINGS_HREF}/automations`,
    label: { he: automationsHe.page.title, en: automationsEn.page.title },
    keywords: ['אוטומציה', 'תזכורות', 'התראות', 'automation', 'reminders', 'alerts'],
    roles: RESTAURANT_READERS,
  },
];

/** The entries `role` can reach, in index order. */
export function settingsFor(role: UserRole): SettingEntry[] {
  return SETTINGS_INDEX.filter((e) => !e.roles || e.roles.includes(role));
}
