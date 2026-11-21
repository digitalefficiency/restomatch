'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, ShortcutSheet, type PaletteItem, type PaletteScreen } from '@/lib/components/palette';
import { taskRow } from '@/lib/components/notifications/rows';
import { trpc } from '@/lib/trpc/client';
import { formatIls } from '@/lib/money';
import { HOTKEYS } from '@/lib/hotkeys';
import { useLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import { overview } from '@/lib/i18n/messages/overview';
import { useMediaMatch, usePrefs } from '@/lib/prefs';
import type { NavViewer } from '../types';
import { routeByKey } from '../registry';
import { canFollowPath } from '../visibility';
import { shellModel } from '../shellModel';
import { QUEUE_KEY } from '../queue';
import { settingsFor } from '../settingsIndex';
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
 */
export function PaletteMount({ viewer, ui }: { viewer: NavViewer; ui: ShellUi }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT(nav) as unknown as (key: string) => string;
  const ts = useT(navShell) as unknown as (key: string) => string;
  const to = useT(overview);
  const fieldRole = FIELD_ROLES.has(viewer.role);
  const prefs = usePrefs();
  // DS3-06's rule: a setting that does nothing on this device is absent (lib/prefs/README.md). Density is
  // fixed on a touch pointer or a narrow window; the side menu needs ≥ 1024; single keys need a keyboard.
  const coarse = useMediaMatch('(pointer: coarse)');
  const phone = ui.viewport === 'narrow' && coarse;

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
    const list: Array<{ id: string; label: string; keywords: readonly string[]; keys?: readonly string[]; run: () => void }> = [];
    if (!ui.flat && ui.viewport !== 'narrow') {
      list.push({
        id: 'rail',
        label: ui.mode === 'rail' ? ts('commands.expand') : ts('commands.collapse'),
        keywords: ['תפריט', 'כיווץ', 'הרחבה', 'menu', 'sidebar', 'collapse', 'expand', 'ctrl b'],
        keys: ['Mod', 'B'],
        run: ui.toggleRail,
      });
    }
    if (!prefs.touch) {
      const compact = prefs.density === 'compact';
      list.push({
        id: 'density',
        label: compact ? ts('commands.densityRegular') : ts('commands.densityCompact'),
        keywords: ['צפיפות', 'שורות', 'רגיל', 'צפוף', 'density', 'compact', 'rows'],
        run: () => prefs.setDensity(compact ? 'regular' : 'compact'),
      });
    }
    {
      const large = prefs.textSize === 'large';
      list.push({
        id: 'textSize',
        label: large ? ts('commands.textRegular') : ts('commands.textLarge'),
        keywords: ['גודל טקסט', 'טקסט', 'אותיות', 'גדול', 'text', 'size', 'large'],
        run: () => prefs.setTextSize(large ? 'regular' : 'large'),
      });
    }
    if (!phone) {
      list.push({
        id: 'singleKeys',
        label: ui.singleKeys ? ts('commands.singleKeysOff') : ts('commands.singleKeysOn'),
        keywords: ['קיצורים', 'מקשים', 'מקלדת', 'shortcuts', 'keys', 'keyboard'],
        run: () => ui.setSingleKeys(!ui.singleKeys),
      });
      list.push({
        id: 'shortcuts',
        label: ts('commands.shortcuts'),
        keywords: ['קיצורים', 'מקלדת', 'shortcuts', 'keyboard', '?'],
        keys: ['?'],
        run: ui.openCheat,
      });
    }
    return list;
  }, [ui, ts, prefs, phone]);

  const settings: PaletteScreen[] = useMemo(
    () =>
      settingsFor(viewer.role).map((s) => ({
        key: `setting:${s.id}`,
        href: s.href,
        label: s.label[locale],
        aliases: s.keywords,
      })),
    [viewer.role, locale],
  );

  return (
    <>
      <CommandPalette
        open={ui.paletteOpen}
        onClose={ui.closePalette}
        role={viewer.role}
        locale={locale}
        screens={screens}
        canSee={(href) => canFollowPath(viewer, href.split('#')[0]!)}
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
