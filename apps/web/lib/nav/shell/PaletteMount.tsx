'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, ShortcutSheet, type PaletteCommand, type PaletteItem, type PaletteScreen } from '@/lib/components/palette';
import { taskRow } from '@/lib/components/notifications/rows';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { HOTKEYS } from '@/lib/hotkeys';
import { useLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import { overview } from '@/lib/i18n/messages/overview';
import { useIsPhone } from '@/lib/prefs';
import { useDisplayCommands, useSettingsPaletteScreens } from '@/app/dashboard/settings/_index/palette';
import type { NavViewer } from '../types';
import { routeByKey } from '../registry';
import { canFollowPath } from '../visibility';
import { shellModel } from '../shellModel';
import { QUEUE_KEY } from '../queue';
import type { ShellUi } from './ShellFrame';

const FIELD_ROLES = new Set(['chef', 'receiver']);

/**
 * The command palette and the `?` cheat sheet, mounted once by the shell
 * (DS3-02; they existed since W3-04 but nothing rendered them). It keeps what
 * the palette holds — waiting work, recents, screens, records, actions — and
 * adds display commands and every setting (DS3 SPEC §10.5). Screens are the
 * viewer's own menu entries (so a G-chord or a result never leads to a screen
 * the role cannot open), with their G-chord keys. A money action only opens
 * its own screen; nothing is approved from here (sidebar spec §7.4).
 *
 * The settings and the density, text and single-key commands are DS3-06's
 * (app/dashboard/settings/_index/palette.ts): already role-filtered, translated,
 * and absent where they do nothing on this device. The side menu's command is
 * the shell's own setter (with its Ctrl/⌘ B chip, never for the flat rail),
 * and the cheat sheet's is added here.
 */
export function PaletteMount({ viewer, ui }: { viewer: NavViewer; ui: ShellUi }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT(nav) as unknown as (key: string) => string;
  const ts = useT(navShell) as unknown as (key: string) => string;
  const to = useT(overview);
  const fieldRole = FIELD_ROLES.has(viewer.role);
  // DS3-06's rule: a command that does nothing on this device is absent (lib/prefs/README.md): no keyboard
  // on a phone, so no cheat sheet there either.
  const phone = useIsPhone();
  const displayCommands = useDisplayCommands();
  const settingScreens = useSettingsPaletteScreens();

  const screens: PaletteScreen[] = useMemo(() => {
    const m = shellModel(viewer);
    const items = [...m.top, ...m.groups.flatMap((g) => g.items), ...m.footer.flatMap((g) => g.items), ...m.account];
    return items.map((i) => ({
      key: i.key,
      href: i.href,
      label: i.key === QUEUE_KEY ? ts('queue') : t(`links.${i.key}`),
      aliases: routeByKey(i.key)?.aliases ?? [],
    }));
  }, [viewer, t, ts]);

  const targets = useMemo(() => new Set(screens.map((s) => s.href)), [screens]);
  // The G-chords follow the same list: a chord to a screen the role does not have does nothing.
  useEffect(() => {
    ui.goCheck.current = (href) => targets.has(href);
  }, [ui.goCheck, targets]);

  const chords = useMemo(() => {
    const out: Record<string, readonly string[]> = {};
    for (const h of HOTKEYS) if (h.chord && targets.has(h.chord.href)) out[h.chord.href] = h.keys;
    return out;
  }, [targets]);

  // "מחכה לך": the task spine (the same request as the bell and לטיפולי). The server nulls ₪ for chef and receiver.
  const tasks = trpc.tasks.mine.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1, enabled: ui.paletteOpen });
  const waiting: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = [];
    for (const task of tasks.data?.tasks ?? []) {
      if (task.scope !== 'mine') continue;
      const row = taskRow(task, to, locale, (agorot) => formatIls(agorot / 100, { locale }));
      if (!row) continue;
      const money = !fieldRole && row.agorot !== null && row.agorot > 0 ? formatIls(row.agorot / 100, { locale, maximumFractionDigits: 0 }) : null;
      out.push({ kind: 'waiting', id: row.key, label: row.label, secondary: money ?? row.countText ?? undefined, href: row.href });
    }
    return out;
  }, [tasks.data, to, locale, fieldRole]);

  const commands = useMemo(() => {
    const list: PaletteCommand[] = [];
    if (!ui.flat && ui.viewport !== 'narrow') {
      list.push({
        id: 'rail',
        label: ui.mode === 'rail' ? ts('commands.expand') : ts('commands.collapse'),
        keywords: ['תפריט', 'כיווץ', 'הרחבה', 'menu', 'sidebar', 'collapse', 'expand', 'ctrl b'],
        keys: ['Mod', 'B'],
        run: ui.toggleRail,
      });
    }
    // DS3-06's density, text-size and single-key commands; its own side-menu command is replaced by the one above.
    for (const c of displayCommands) {
      if (c.id !== 'rail') list.push({ id: c.id, label: c.label, keywords: c.keywords, run: c.run });
    }
    if (!phone) {
      list.push({
        id: 'shortcuts',
        label: ts('commands.shortcuts'),
        keywords: ['קיצורים', 'מקלדת', 'shortcuts', 'keyboard', '?'],
        keys: ['?'],
        run: ui.openCheat,
      });
    }
    return list;
  }, [ui, ts, displayCommands, phone]);

  // "הגדרות": every setting and section the viewer may open, with its section as the secondary line.
  const settings: PaletteScreen[] = useMemo(
    () =>
      settingScreens.map((s) => ({
        key: s.key,
        href: s.href,
        label: s.label,
        aliases: s.aliases,
        ...(s.section !== s.label ? { secondary: s.section } : {}),
      })),
    [settingScreens],
  );

  return (
    <>
      <CommandPalette
        open={ui.paletteOpen}
        onClose={ui.closePalette}
        role={viewer.role}
        locale={locale}
        screens={screens}
        // A settings address carries ?s=… and #anchor; the route check reads the path.
        canSee={(href) => canFollowPath(viewer, href.split(/[?#]/)[0]!)}
        onNavigate={(href) => router.push(href)}
        waiting={waiting}
        canAsk={viewer.features.includes('aiAssistant')}
        commands={commands}
        settings={settings}
        // G-chords are single keys: show their chips only while single keys are on.
        chords={ui.singleKeys ? chords : undefined}
      />
      <ShortcutSheet
        open={ui.cheatOpen}
        onClose={ui.closeCheat}
        locale={locale}
        canGo={(href) => targets.has(href)}
        singleKeys={ui.singleKeys}
        onSingleKeysChange={ui.setSingleKeys}
      />
    </>
  );
}
