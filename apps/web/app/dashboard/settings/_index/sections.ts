import type { UserRole } from '@restomatch/db';

/**
 * The settings map (DS3-06, SPEC §10.5): two groups ("אני", "המסעדה"), one
 * section per route, a scope per section ("במכשיר הזה" / "אצלך, בכל מכשיר" /
 * "לכל המסעדה") and every single setting, so the search field and the command
 * palette (DS3-02) find any setting. Pure data: titles are message keys of the
 * `settings` namespace (resolve with `useT(settings)`), hrefs are routes with
 * the setting's row anchor.
 */

export type SettingsGroup = 'me' | 'restaurant';
/** device = this browser only; user = the person, on every device; restaurant = everyone in the restaurant. */
export type SettingsScope = 'device' | 'user' | 'restaurant';

export type SectionId =
  | 'display'
  | 'account'
  | 'security'
  | 'privacy'
  | 'restaurant'
  | 'letterhead'
  | 'rules'
  | 'automations';

/** Roles that see the restaurant group (owner edits; manager and bookkeeper read, as today). */
export const RESTAURANT_ROLES: readonly UserRole[] = ['owner', 'manager', 'bookkeeper'];
const ALL_ROLES: readonly UserRole[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];

export interface SettingsSection {
  id: SectionId;
  group: SettingsGroup;
  scope: SettingsScope;
  href: string;
  /** Message keys (settings namespace). The automations page keeps its own header copy (automations namespace). */
  titleKey: string;
  subtitleKey?: string;
  roles: readonly UserRole[];
}

export const SETTINGS_BASE = '/dashboard/settings';

export const SECTIONS: readonly SettingsSection[] = [
  {
    id: 'display',
    group: 'me',
    scope: 'device',
    href: SETTINGS_BASE,
    titleKey: 'areas.display.title',
    subtitleKey: 'areas.display.subtitle',
    roles: ALL_ROLES,
  },
  {
    id: 'account',
    group: 'me',
    scope: 'user',
    href: `${SETTINGS_BASE}?s=account`,
    titleKey: 'areas.account.title',
    subtitleKey: 'areas.account.subtitle',
    roles: ALL_ROLES,
  },
  {
    id: 'security',
    group: 'me',
    scope: 'user',
    href: `${SETTINGS_BASE}?s=security`,
    titleKey: 'areas.security.title',
    subtitleKey: 'areas.security.subtitle',
    roles: ALL_ROLES,
  },
  {
    id: 'privacy',
    group: 'me',
    scope: 'user',
    href: `${SETTINGS_BASE}?s=privacy`,
    titleKey: 'areas.privacy.title',
    subtitleKey: 'areas.privacy.subtitle',
    roles: ALL_ROLES,
  },
  {
    id: 'restaurant',
    group: 'restaurant',
    scope: 'restaurant',
    href: `${SETTINGS_BASE}?s=restaurant`,
    titleKey: 'areas.restaurant.title',
    subtitleKey: 'areas.restaurant.subtitle',
    roles: RESTAURANT_ROLES,
  },
  {
    id: 'letterhead',
    group: 'restaurant',
    scope: 'restaurant',
    href: `${SETTINGS_BASE}?s=letterhead`,
    titleKey: 'areas.letterhead.title',
    subtitleKey: 'areas.letterhead.subtitle',
    roles: RESTAURANT_ROLES,
  },
  {
    id: 'rules',
    group: 'restaurant',
    scope: 'restaurant',
    href: `${SETTINGS_BASE}?s=rules`,
    titleKey: 'areas.rules.title',
    subtitleKey: 'areas.rules.subtitle',
    roles: RESTAURANT_ROLES,
  },
  {
    id: 'automations',
    group: 'restaurant',
    scope: 'restaurant',
    href: `${SETTINGS_BASE}/automations`,
    titleKey: 'areas.automations.title',
    roles: RESTAURANT_ROLES,
  },
];

export type AbsentOn = 'coarse' | 'narrow' | 'phone';

/** What the current device is, for `absentOn` (all false on the server). */
export interface DeviceFacts {
  coarse?: boolean;
  narrow?: boolean;
  phone?: boolean;
}

export interface SettingEntry {
  /** Stable id; also the row anchor (`#<id>`) on its section page. */
  id: string;
  section: SectionId;
  titleKey: string;
  /** Extra words the search should match (message key; a space-separated list). */
  keywordsKey?: string;
  /**
   * Where the setting does nothing and is therefore absent (SPEC §10.5): on a
   * touch pointer (density is fixed), below 1024 px (no side menu), on a phone
   * (no keyboard). The queries are lib/prefs COARSE_QUERY / NARROW_QUERY / PHONE_QUERY.
   */
  absentOn?: AbsentOn;
  /** The anchor on the section page when several settings share one block (a whole form). Defaults to `id`. */
  anchor?: string;
}

export const SETTINGS: readonly SettingEntry[] = [
  {
    id: 'density',
    section: 'display',
    titleKey: 'display.densityTitle',
    keywordsKey: 'index.keywords.density',
    absentOn: 'coarse',
  },
  {
    id: 'text',
    section: 'display',
    titleKey: 'display.textTitle',
    keywordsKey: 'index.keywords.text',
  },
  {
    id: 'rail',
    section: 'display',
    titleKey: 'display.railTitle',
    keywordsKey: 'index.keywords.rail',
    absentOn: 'narrow',
  },
  {
    id: 'keys',
    section: 'display',
    titleKey: 'display.keysTitle',
    keywordsKey: 'index.keywords.keys',
    absentOn: 'phone',
  },
  {
    id: 'language',
    section: 'account',
    titleKey: 'account.languageTitle',
    keywordsKey: 'index.keywords.language',
  },
  {
    id: 'password',
    section: 'account',
    titleKey: 'account.passwordTitle',
    keywordsKey: 'index.keywords.password',
  },
  {
    id: 'devices',
    section: 'account',
    titleKey: 'account.devicesTitle',
    keywordsKey: 'index.keywords.devices',
  },
  { id: 'phone', section: 'account', titleKey: 'phone.title', keywordsKey: 'index.keywords.phone' },
  {
    id: 'twofa',
    section: 'security',
    titleKey: 'twoFactor.title',
    keywordsKey: 'index.keywords.twofa',
  },
  {
    id: 'export',
    section: 'privacy',
    titleKey: 'dsr.export',
    keywordsKey: 'index.keywords.export',
    anchor: 'dsr',
  },
  {
    id: 'delete',
    section: 'privacy',
    titleKey: 'dsr.delete',
    keywordsKey: 'index.keywords.delete',
    anchor: 'dsr',
  },
  { id: 'name', section: 'restaurant', titleKey: 'profile.name', anchor: 'profile' },
  {
    id: 'businessId',
    section: 'restaurant',
    titleKey: 'profile.businessId',
    keywordsKey: 'index.keywords.businessId',
    anchor: 'profile',
  },
  {
    id: 'vat',
    section: 'restaurant',
    titleKey: 'profile.vat',
    keywordsKey: 'index.keywords.vat',
    anchor: 'profile',
  },
  {
    id: 'timezone',
    section: 'restaurant',
    titleKey: 'profile.timezone',
    keywordsKey: 'index.keywords.timezone',
    anchor: 'profile',
  },
  {
    id: 'legalName',
    section: 'letterhead',
    titleKey: 'letterhead.legalName',
    anchor: 'letterhead',
  },
  { id: 'address', section: 'letterhead', titleKey: 'letterhead.address', anchor: 'letterhead' },
  { id: 'letterPhone', section: 'letterhead', titleKey: 'letterhead.phone', anchor: 'letterhead' },
  {
    id: 'email',
    section: 'letterhead',
    titleKey: 'letterhead.email',
    keywordsKey: 'index.keywords.email',
    anchor: 'letterhead',
  },
  {
    id: 'pricePercent',
    section: 'rules',
    titleKey: 'thresholds.fields.pricePercent.label',
    keywordsKey: 'index.keywords.thresholds',
  },
  {
    id: 'priceAbsolute',
    section: 'rules',
    titleKey: 'thresholds.fields.priceAbsolute.label',
    keywordsKey: 'index.keywords.thresholds',
  },
  {
    id: 'qtyPercent',
    section: 'rules',
    titleKey: 'thresholds.fields.qtyPercent.label',
    keywordsKey: 'index.keywords.thresholds',
  },
  {
    id: 'qtyAbsolute',
    section: 'rules',
    titleKey: 'thresholds.fields.qtyAbsolute.label',
    keywordsKey: 'index.keywords.thresholds',
  },
  {
    id: 'blockPricePercent',
    section: 'rules',
    titleKey: 'thresholds.fields.blockPricePercent.label',
    keywordsKey: 'index.keywords.block',
  },
  {
    id: 'approvals',
    section: 'rules',
    titleKey: 'thresholds.approvalsTitle',
    keywordsKey: 'index.keywords.approvals',
  },
  {
    id: 'ocrReviewThreshold',
    section: 'rules',
    titleKey: 'thresholds.fields.ocrReviewThreshold.label',
    keywordsKey: 'index.keywords.ocr',
  },
  {
    id: 'automations',
    section: 'automations',
    titleKey: 'areas.automations.title',
    keywordsKey: 'index.keywords.automations',
    anchor: 'automations-list',
  },
];

export function sectionById(id: SectionId): SettingsSection {
  return SECTIONS.find((s) => s.id === id)!;
}

/** Sections opened through `?s=` on /dashboard/settings (automations keeps its own route). */
const PARAM_SECTIONS: readonly SectionId[] = [
  'account',
  'security',
  'privacy',
  'restaurant',
  'letterhead',
  'rules',
];

/** `?s=` → the section; anything else (absent, unknown, an array) → "תצוגה". */
export function sectionFromParam(raw: string | string[] | undefined | null): SectionId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (PARAM_SECTIONS as readonly string[]).includes(v) ? (v as SectionId) : 'display';
}

/** The open section for a pathname and its `?s=` value. */
export function activeSection(pathname: string | null, s: string | null): SectionId {
  const p = (pathname ?? '').replace(/\/+$/, '');
  if (p === `${SETTINGS_BASE}/automations` || p.startsWith(`${SETTINGS_BASE}/automations/`))
    return 'automations';
  return sectionFromParam(s);
}

/** The sections a role sees, in order. */
export function sectionsFor(role: UserRole | null | undefined): SettingsSection[] {
  return SECTIONS.filter((s) => (role ? s.roles.includes(role) : s.group === 'me'));
}

/** Is a setting absent on this device (it does nothing there)? */
export function isAbsent(e: SettingEntry, device: DeviceFacts): boolean {
  return !!e.absentOn && !!device[e.absentOn];
}

/** The settings a role finds on this device (the ones that do nothing here are left out). */
export function settingsFor(
  role: UserRole | null | undefined,
  device: DeviceFacts = {},
): SettingEntry[] {
  const visible = new Set(sectionsFor(role).map((s) => s.id));
  return SETTINGS.filter((e) => visible.has(e.section) && !isAbsent(e, device));
}

/** Where a setting lives: its section route plus its row anchor. */
export function settingHref(e: SettingEntry): string {
  return `${sectionById(e.section).href}#${e.anchor ?? e.id}`;
}

/** Legacy anchors of the one-page settings screen (links elsewhere still use them). */
export const LEGACY_HASHES: Readonly<Record<string, string>> = {
  letterhead: `${SETTINGS_BASE}?s=letterhead#letterhead`,
  rules: `${SETTINGS_BASE}?s=rules`,
  matching: `${SETTINGS_BASE}?s=rules`,
  profile: `${SETTINGS_BASE}?s=restaurant#profile`,
  security: `${SETTINGS_BASE}?s=security#twofa`,
  twofa: `${SETTINGS_BASE}?s=security#twofa`,
  privacy: `${SETTINGS_BASE}?s=privacy#dsr`,
  account: `${SETTINGS_BASE}?s=account`,
  phone: `${SETTINGS_BASE}?s=account#phone`,
};
