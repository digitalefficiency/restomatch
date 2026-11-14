import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { settings } from '@/lib/i18n/messages/settings';
import {
  LEGACY_HASHES,
  SECTIONS,
  SETTINGS,
  activeSection,
  sectionFromParam,
  sectionsFor,
  settingHref,
  settingsFor,
} from '../sections';
import { settingsPaletteEntries } from '../palette';

describe('the settings map (two groups, a scope per section)', () => {
  it('groups "אני" then "המסעדה", each section with a scope', () => {
    expect(SECTIONS.map((s) => [s.id, s.group, s.scope])).toEqual([
      ['display', 'me', 'device'],
      ['account', 'me', 'user'],
      ['security', 'me', 'user'],
      ['privacy', 'me', 'user'],
      ['restaurant', 'restaurant', 'restaurant'],
      ['letterhead', 'restaurant', 'restaurant'],
      ['rules', 'restaurant', 'restaurant'],
      ['automations', 'restaurant', 'restaurant'],
    ]);
  });

  it('receiver and chef see only "אני"; owner, manager and bookkeeper see both groups', () => {
    for (const role of ['receiver', 'chef'] as const) {
      expect(sectionsFor(role).every((s) => s.group === 'me')).toBe(true);
      expect(settingsFor(role).some((e) => e.section === 'rules')).toBe(false);
    }
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      expect(sectionsFor(role).map((s) => s.id)).toContain('rules');
    }
  });

  it('on a phone the settings that do nothing there are not offered', () => {
    const desk = settingsFor('owner').map((e) => e.id);
    const phone = settingsFor('owner', { touch: true }).map((e) => e.id);
    expect(desk).toEqual(expect.arrayContaining(['rail', 'keys']));
    expect(phone).not.toContain('rail');
    expect(phone).not.toContain('keys');
    expect(phone).toContain('density');
  });

  it('every setting links to its section with its anchor; ids are unique', () => {
    expect(new Set(SETTINGS.map((e) => e.id)).size).toBe(SETTINGS.length);
    expect(settingHref(SETTINGS.find((e) => e.id === 'qtyPercent')!)).toBe('/dashboard/settings?s=rules#qtyPercent');
    expect(settingHref(SETTINGS.find((e) => e.id === 'vat')!)).toBe('/dashboard/settings?s=restaurant#profile');
    expect(settingHref(SETTINGS.find((e) => e.id === 'density')!)).toBe('/dashboard/settings#density');
  });

  it('?s= picks the section; anything else is "תצוגה"; automations keeps its route', () => {
    expect(sectionFromParam('rules')).toBe('rules');
    expect(sectionFromParam(['account', 'x'])).toBe('account');
    expect(sectionFromParam('automations')).toBe('display');
    expect(sectionFromParam('nope')).toBe('display');
    expect(sectionFromParam(undefined)).toBe('display');
    expect(activeSection('/dashboard/settings/automations', null)).toBe('automations');
    expect(activeSection('/dashboard/settings', 'letterhead')).toBe('letterhead');
  });

  it('old one-page anchors still land on their section', () => {
    expect(LEGACY_HASHES.letterhead).toBe('/dashboard/settings?s=letterhead#letterhead');
  });

  it('every title and keyword key exists in both languages', () => {
    for (const locale of ['he', 'en'] as const) {
      const t = createTranslator(locale, settings) as unknown as (k: string) => string;
      for (const s of SECTIONS) expect(t(s.titleKey), `${locale} ${s.titleKey}`).not.toBe(s.titleKey);
      for (const s of SECTIONS) if (s.subtitleKey) expect(t(s.subtitleKey), `${locale} ${s.subtitleKey}`).not.toBe(s.subtitleKey);
      for (const e of SETTINGS) {
        expect(t(e.titleKey), `${locale} ${e.titleKey}`).not.toBe(e.titleKey);
        if (e.keywordsKey) expect(t(e.keywordsKey), `${locale} ${e.keywordsKey}`).not.toBe(e.keywordsKey);
      }
    }
  });
});

describe('the palette export (DS3-02)', () => {
  const t = createTranslator('he', settings) as unknown as (k: string) => string;

  it('PaletteScreen-shaped, role-filtered, translated', () => {
    const owner = settingsPaletteEntries(t, 'owner');
    const vat = owner.find((e) => e.key === 'settings.restaurant.vat')!;
    expect(vat).toMatchObject({ href: '/dashboard/settings?s=restaurant#profile', section: 'פרטי המסעדה' });
    expect(vat.aliases).toContain('מע״מ');
    expect(owner.find((e) => e.key === 'settings.rules')).toMatchObject({ label: 'כללי התאמה ואישור' });
    const receiver = settingsPaletteEntries(t, 'receiver');
    expect(receiver.some((e) => e.href.includes('s=rules'))).toBe(false);
    expect(receiver.some((e) => e.key === 'settings.display.density')).toBe(true);
  });

  it('no desk-only setting on a phone', () => {
    const phone = settingsPaletteEntries(t, 'owner', { narrow: true });
    expect(phone.some((e) => e.key === 'settings.display.keys')).toBe(false);
  });
});
