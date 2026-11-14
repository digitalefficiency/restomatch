'use client';

import { useMemo } from 'react';
import type { UserRole } from '@restomatch/db';
import { useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { useNavViewer } from '@/lib/nav/NavProvider';
import { useIsCoarse, useIsNarrow, useIsPhone, usePrefs } from '@/lib/prefs';
import { useShellRail } from '../_components/useShellRail';
import { SECTIONS, sectionById, settingHref, settingsFor, type DeviceFacts } from './sections';

/**
 * The settings for the command palette (DS3-02 owns the palette; DS3-06
 * exports the list). Shapes match lib/components/palette/sections.ts, so the
 * palette can pass them straight in:
 *
 *   const settingScreens = useSettingsPaletteScreens();   // PaletteScreen[] → `screens`
 *   const displayCommands = useDisplayCommands();          // run() instead of href
 *
 * Every entry is already role-filtered (the viewer from NavProvider) and drops
 * the settings that do nothing on this device (density on touch, the side menu
 * below 1024 px, single-key shortcuts on a phone). Titles are translated.
 */

/** PaletteScreen-compatible (`{ key, href, label, aliases }`), plus `section` for a secondary line. */
export interface SettingPaletteEntry {
  key: string;
  href: string;
  label: string;
  aliases: readonly string[];
  section: string;
}

type T = (key: string) => string;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

export function settingsPaletteEntries(t: T, role: UserRole | null, device: DeviceFacts = {}): SettingPaletteEntry[] {
  const sections = SECTIONS.filter((s) => (role ? s.roles.includes(role) : s.group === 'me')).map((s) => ({
    key: `settings.${s.id}`,
    href: s.href,
    label: t(s.titleKey),
    aliases: [t('title')],
    section: t('title'),
  }));
  const rows = settingsFor(role, device).map((e) => {
    const sec = sectionById(e.section);
    return {
      key: `settings.${e.section}.${e.id}`,
      href: settingHref(e),
      label: t(e.titleKey),
      aliases: [t(sec.titleKey), t('title'), ...(e.keywordsKey ? words(t(e.keywordsKey)) : [])],
      section: t(sec.titleKey),
    };
  });
  return [...sections, ...rows];
}

/** Every setting and section the viewer may open, translated, for the palette's "מסכים". */
export function useSettingsPaletteScreens(): SettingPaletteEntry[] {
  const t = useT(settings) as unknown as T;
  const role = useNavViewer()?.role ?? null;
  const coarse = useIsCoarse();
  const narrow = useIsNarrow();
  const phone = useIsPhone();
  return useMemo(() => settingsPaletteEntries(t, role, { coarse, narrow, phone }), [t, role, coarse, narrow, phone]);
}

/** A display command: acts at once, per device (no navigation). */
export interface DisplayCommand {
  id: 'rail' | 'density' | 'text' | 'keys';
  label: string;
  keywords: readonly string[];
  run: () => void;
}

/**
 * The side menu, density, text size and single-key shortcuts as commands
 * (SPEC §10.5 "Ctrl K … runs display commands: collapse the menu, density,
 * text size, single-key shortcuts"). Labels say what the command will do next
 * ("מעבר למצב צפוף" while regular). Absent where they do nothing: the menu
 * below 1024 px, density on touch, shortcuts on a phone.
 */
export function useDisplayCommands(): DisplayCommand[] {
  const t = useT(settings) as unknown as T;
  const p = usePrefs();
  const narrow = useIsNarrow();
  const phone = useIsPhone();
  const shell = useShellRail(false);
  return useMemo(() => {
    const list: DisplayCommand[] = [];
    if (shell.available && !narrow) {
      list.push({
        id: 'rail',
        label: shell.rail ? t('commands.railExpand') : t('commands.railCollapse'),
        keywords: words(t('commands.keywords.rail')),
        run: () => shell.setRail(!shell.rail),
      });
    }
    if (!p.coarse) {
      list.push({
        id: 'density',
        label: p.density === 'compact' ? t('commands.densityRegular') : t('commands.densityCompact'),
        keywords: words(t('commands.keywords.density')),
        run: () => p.setDensity(p.density === 'compact' ? 'regular' : 'compact'),
      });
    }
    list.push({
      id: 'text',
      label: p.textSize === 'large' ? t('commands.textRegular') : t('commands.textLarge'),
      keywords: words(t('commands.keywords.text')),
      run: () => p.setTextSize(p.textSize === 'large' ? 'regular' : 'large'),
    });
    if (!phone) {
      list.push({
        id: 'keys',
        label: p.singleKeys ? t('commands.keysOff') : t('commands.keysOn'),
        keywords: words(t('commands.keywords.keys')),
        run: () => p.setSingleKeys(!p.singleKeys),
      });
    }
    return list;
  }, [t, p, narrow, phone, shell]);
}
