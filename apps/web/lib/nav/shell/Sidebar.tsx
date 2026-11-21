'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { toRouteBadges, useNavBadges, type BadgeWords } from '@/lib/components/notifications';
import { trpc } from '@/lib/trpc/client';
import { useLocale, useT } from '@/lib/i18n/client';
import { dirOf } from '@/lib/i18n/config';
import { nav } from '@/lib/i18n/messages/nav';
import { common } from '@/lib/i18n/messages/common';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import { HOTKEYS } from '@/lib/hotkeys';
import type { GroupKey, NavViewer } from '../types';
import { defaultOpenGroups, planFolds } from '../groups';
import { readGroupState, safeStorage, writeGroupState } from '../prefs';
import { sanitizeFavourites } from '../favourites';
import { badgeLook, groupDot, withSingleSolid, type BadgeValueLike } from '../badgeLook';
import { inSafeTriangle, type Pt } from '../aim';
import { QUEUE_KEY, queueBadge } from '../queue';
import { shellModel, type ShellItem } from '../shellModel';
import { activeNavKey } from '../visibility';
import { routeBadgeMap } from '../badges';
import { UTILITY_ICONS } from '../icons';
import { SUPPORT_LINKS } from '../support';
import { useShellUi } from './ShellFrame';
import { NavGroup, type FlyKey } from './NavGroup';
import { NavIcon, NavItem, badgeWordsFor } from './NavItem';
import { AccountMenu, type AccountMenuProps } from './AccountMenu';
import { showNavNote } from './NavTooltip';
import css from './shell.module.css';

const HOVER_OPEN_MS = 220;
const AIM_WAIT_MS = 300;
const LEAVE_MS = 300;
const LEAVE_AIM_MS = 400;
const FIELD_ROLES = new Set(['chef', 'receiver']);
/** `nav.badges` sources that carry T2 ₪ (§5.1): money that waits. */
const T2_SOURCES: ReadonlySet<string> = new Set(['approvals', 'claims']);
const ROUTE_BADGES = routeBadgeMap();

/** G-chord keys per destination, from the one shortcut registry (shown in tooltips; §8). */
const CHORDS: ReadonlyMap<string, string> = new Map(
  HOTKEYS.filter((h) => h.chord).map((h) => [h.chord!.href, h.keys.join(' ')] as const),
);

function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
    (el) => el.tabIndex !== -1 && el.getClientRects().length > 0 && !el.closest('[role="menu"]'),
  );
}

export interface SidebarProps extends Omit<AccountMenuProps, 'roleLabel'> {
  viewer: NavViewer;
  restaurantName: string;
  roleLabel: string;
  /** The branch switcher for the head (≥ 2 memberships), rendered by the layout. */
  switcher?: React.ReactNode;
  /** "בעלים · 3 סניפים" under the restaurant name. */
  subline: string;
}

/**
 * The desktop side menu (≥ 1024; sidebar spec §1–§10, DS3 clean finish). One
 * DOM: rows and group headers in the 248 panel, labelled tiles and flyouts in
 * the 64 rail; the stylesheet picks by the aside's width, so the server's
 * cookie decides the first paint. Chef and receiver get the flat labelled rail.
 */
export function Sidebar({ viewer, restaurantName, roleLabel, switcher, subline, userName, email, isPlatformAdmin, receiverLangs, logout }: SidebarProps) {
  const ui = useShellUi();
  const t = useT(nav) as unknown as (key: string, vars?: Record<string, string | number>) => string;
  const ts = useT(navShell) as unknown as (key: string, vars?: Record<string, string | number>) => string;
  const tc = useT(common) as unknown as (key: string) => string;
  const locale = useLocale();
  const dir = dirOf(locale);
  const pathname = usePathname();
  const badges = useNavBadges();
  // The provider owns the `nav.badges` request; this observer only reads the same cache entry, so the
  // fit rule can tell "no ₪ yet" from "no ₪" (below).
  const badgeQuery = trpc.nav.badges.useQuery(undefined, { enabled: false });
  const model = useMemo(() => shellModel(viewer), [viewer]);
  const flat = model.flat;
  const fieldRole = FIELD_ROLES.has(viewer.role);
  const rail = ui.mode === 'rail' || ui.mode === 'flat';
  const panel = ui.mode === 'panel' || ui.mode === 'overlay';
  const activeKey = activeNavKey(pathname);

  // לטיפולי: the same source as the bell and the home (tasks.mine; react-query shares the request).
  const tasks = trpc.tasks.mine.useQuery(undefined, {
    enabled: !fieldRole,
    staleTime: 30_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const queue = useMemo(() => queueBadge(tasks.data?.tasks), [tasks.data]);

  const words: BadgeWords = useMemo(
    () => ({
      items: (count) => t('badge.items', { count }),
      atRisk: (amount) => t('badge.atRisk', { amount }),
      owed: (amount) => t('badge.owed', { amount }),
      blocking: t('badge.blocking'),
    }),
    [t],
  );

  const valueOf = useCallback(
    (key: string): BadgeValueLike | undefined => (key === QUEUE_KEY ? queue : (badges[key] as BadgeValueLike | undefined)),
    [badges, queue],
  );

  const allGroups = useMemo(() => [...model.groups, ...model.footer], [model]);
  // Badge looks in visual order, so "at most one solid pill" keeps the first (§5.1).
  const looks = useMemo(() => {
    const order: ShellItem[] = [...model.top, ...allGroups.flatMap((g) => g.items)];
    // A view-only row carries no badge (§4.1: its count is work the viewer cannot do).
    return withSingleSolid(order.map((i) => [i.key, i.viewOnly ? null : badgeLook(valueOf(i.key), { fieldRole })] as const));
  }, [model, allGroups, valueOf, fieldRole]);

  const activeGroup = allGroups.find((g) => g.items.some((i) => i.key === activeKey))?.group ?? null;
  const t2Groups = useMemo(
    () => allGroups.filter((g) => groupDot(g.items.map((i) => i.key), looks) !== null).map((g) => g.group),
    [allGroups, looks],
  );
  // Which groups the fit rule must never fold (§4.2: never one that holds T2 ₪). Until the badges answer,
  // a group that can carry T2 counts as carrying it, so כסף is not folded in the first frames and left
  // folded once its ₪ arrives. Once they answer, the observer's own snapshot decides: the context can lag
  // one render behind the cache, and the two must never disagree about "known".
  const mayHoldT2 = useMemo(
    () =>
      fieldRole
        ? []
        : allGroups.filter((g) => g.items.some((i) => T2_SOURCES.has(ROUTE_BADGES[i.key] ?? ''))).map((g) => g.group),
    [allGroups, fieldRole],
  );
  const snapshotT2 = useMemo(() => {
    if (!badgeQuery.isSuccess) return badgeQuery.isError ? [] : null;
    const snap = toRouteBadges(badgeQuery.data?.badges, ROUTE_BADGES);
    return allGroups
      .filter((g) => g.items.some((i) => !i.viewOnly && badgeLook(snap[i.key] as BadgeValueLike | undefined, { fieldRole })?.t2))
      .map((g) => g.group);
  }, [badgeQuery.isSuccess, badgeQuery.isError, badgeQuery.data, allGroups, fieldRole]);
  const holdsT2 = useMemo(
    () => [...new Set([...t2Groups, ...(snapshotT2 ?? mayHoldT2)])],
    [t2Groups, snapshotT2, mayHoldT2],
  );

  /* ── groups: per-role defaults, the user's toggles, the page's group always open (§4.2) ── */
  const [open, setOpen] = useState<Set<GroupKey>>(() => {
    const s = new Set(defaultOpenGroups(viewer.role));
    if (activeGroup) s.add(activeGroup);
    return s;
  });
  const seq = useRef(0);
  const openedAt = useRef<Partial<Record<GroupKey, number>>>({});
  const justOpened = useRef<GroupKey | null>(null);
  // Folds while the menu settles after a page load are silent: nobody asked for anything yet. Folds after
  // an open, a navigation or a resize are announced (and shown beside the group); folds that follow a
  // change of data or of mode (expanding, the overlay) stay silent too.
  const quiet = useRef(true);
  const announceNext = useRef(false);
  useEffect(() => {
    const settle = window.setTimeout(() => {
      quiet.current = false;
    }, 600);
    // Seed the LRU order with the defaults, in job order (the first default is the oldest).
    for (const g of defaultOpenGroups(viewer.role)) openedAt.current[g] = ++seq.current;
    const stored = readGroupState(viewer.role, safeStorage());
    if (!stored) return () => window.clearTimeout(settle);
    setOpen((prev) => {
      const next = new Set(prev);
      for (const [g, isOpen] of Object.entries(stored) as [GroupKey, boolean][]) {
        if (isOpen) next.add(g);
        else if (g !== activeGroup) next.delete(g);
      }
      return next;
    });
    return () => window.clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after hydration
  }, [viewer.role]);
  useEffect(() => {
    if (!activeGroup) return;
    setOpen((prev) => {
      if (prev.has(activeGroup)) return prev;
      openedAt.current[activeGroup] = ++seq.current;
      announceNext.current = true; // a navigation opened it: a fold it causes is announced
      return new Set(prev).add(activeGroup);
    });
  }, [activeGroup]);

  const setGroup = useCallback(
    (g: GroupKey, isOpen: boolean, persist = true) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (isOpen) {
          next.add(g);
          openedAt.current[g] = ++seq.current;
          justOpened.current = g;
          announceNext.current = true;
        } else next.delete(g);
        if (persist) {
          const state: Partial<Record<GroupKey, boolean>> = {};
          for (const x of allGroups) state[x.group] = next.has(x.group);
          writeGroupState(viewer.role, state, safeStorage());
        }
        return next;
      });
    },
    [allGroups, viewer.role],
  );

  /* ── favourites (≤ 5, per role on this device) ── */
  const navKeys = useMemo(() => new Set(allGroups.flatMap((g) => g.items.map((i) => i.key))), [allGroups]);
  const favItems = useMemo(() => {
    const keys = sanitizeFavourites(ui.favourites, navKeys);
    const byKey = new Map(allGroups.flatMap((g) => g.items).map((i) => [i.key, i] as const));
    return keys.map((k) => byKey.get(k)).filter((i): i is ShellItem => Boolean(i));
  }, [ui.favourites, navKeys, allGroups]);

  /* ── the scroll region: the overflow fade and the fit rule ── */
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef(new Map<FlyKey, HTMLButtonElement>());
  const flyRefs = useRef(new Map<FlyKey, HTMLDivElement>());
  const [clip, setClip] = useState({ t: false, b: false });
  const [resizeTick, setResizeTick] = useState(0);
  const measureClip = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const t = sc.scrollTop > 2;
    const b = sc.scrollHeight - sc.clientHeight - sc.scrollTop > 2;
    setClip((c) => (c.t === t && c.b === b ? c : { t, b }));
  }, []);
  useEffect(() => {
    const onResize = () => setResizeTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const lastPath = useRef(pathname);
  const lastTick = useRef(resizeTick);
  useLayoutEffect(() => {
    measureClip();
    if (lastPath.current !== pathname || lastTick.current !== resizeTick) {
      lastPath.current = pathname;
      lastTick.current = resizeTick;
      announceNext.current = true;
    }
    const sc = scrollRef.current;
    if (!panel || !sc) {
      announceNext.current = false;
      return;
    }
    const overflow = sc.scrollHeight - sc.clientHeight;
    if (overflow <= 1) {
      justOpened.current = null;
      announceNext.current = false;
      return;
    }
    const savings: Partial<Record<GroupKey, number>> = {};
    for (const g of open) {
      const fly = flyRefs.current.get(g);
      if (fly) savings[g] = fly.offsetHeight + 8;
    }
    // Only groups this menu renders: a stored state for a group another restaurant's flags hide must not be
    // "folded" (saving nothing) and announced.
    const rendered = new Set(allGroups.map((g) => g.group));
    const folds = planFolds({
      overflow,
      open: [...open].filter((g) => rendered.has(g)),
      openedAt: openedAt.current,
      justOpened: justOpened.current,
      here: activeGroup,
      holdsT2,
      savings,
    });
    // `justOpened` stays until the list fits (the next pass may still need folds, never of that group).
    const say = announceNext.current && !quiet.current;
    announceNext.current = false;
    if (folds.length === 0) return;
    setOpen((prev) => new Set([...prev].filter((g) => !folds.includes(g))));
    if (!say) return;
    const names = folds.map((g) => t(`groups.${g}`));
    const joined = names.length > 1 ? `${names.slice(0, -1).join(tc('shell.listSep'))}${tc('shell.listLast')}${names[names.length - 1]}` : names[0]!;
    const text = ts('fit', { groups: joined });
    ui.announce(text);
    const header = headerRefs.current.get(folds[folds.length - 1]!);
    if (header) requestAnimationFrame(() => showNavNote(header, text));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on what changes the list's height
  }, [open, panel, pathname, looks, favItems.length, resizeTick, holdsT2]);

  /* ── flyouts (rail): click / Enter / ← and a 220 ms rest; aim detection keeps the list while crossing (§7.2) ── */
  const [fly, setFly] = useState<{ group: FlyKey; by: 'hover' | 'click' | 'key' } | null>(null);
  const [flyTop, setFlyTop] = useState<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const lastPoint = useRef<Pt | null>(null);
  const clearTimers = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    hoverTimer.current = leaveTimer.current = null;
  };
  const closeFly = useCallback((refocus = false) => {
    clearTimers();
    setFly((cur) => {
      if (cur && refocus) requestAnimationFrame(() => headerRefs.current.get(cur.group)?.focus());
      return null;
    });
  }, []);
  const openFly = useCallback((group: FlyKey, by: 'hover' | 'click' | 'key') => {
    clearTimers();
    setFly({ group, by });
  }, []);
  useEffect(() => closeFly(), [pathname, ui.mode, closeFly]);

  // Place the open flyout: trigger top − 4, clamped 8 px from the viewport edges; focus its first row on keys.
  useLayoutEffect(() => {
    if (!fly) {
      setFlyTop(null);
      return;
    }
    const tile = headerRefs.current.get(fly.group);
    const box = flyRefs.current.get(fly.group);
    if (!tile || !box) return;
    const r = tile.getBoundingClientRect();
    const h = box.offsetHeight;
    setFlyTop(Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 4))));
    if (fly.by === 'key') box.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
  }, [fly]);

  // Outside pointer-down closes it.
  useEffect(() => {
    if (!fly) return;
    const onDown = (e: PointerEvent) => {
      const g = fly.group;
      const target = e.target as Node;
      if (flyRefs.current.get(g)?.contains(target) || headerRefs.current.get(g)?.contains(target)) return;
      closeFly();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [fly, closeFly]);

  const inAim = (p: Pt | null): boolean => {
    if (!fly || !p || !lastPoint.current) return false;
    const box = flyRefs.current.get(fly.group);
    if (!box) return false;
    return inSafeTriangle(p, lastPoint.current, box.getBoundingClientRect(), dir);
  };

  const tileHandlers = (group: FlyKey) => ({
    onPointerEnterTile: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!rail || e.pointerType !== 'mouse') return;
      const p = { x: e.clientX, y: e.clientY };
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
      if (fly?.group === group) return;
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      // Crossing another tile on the way to the open list: wait, and switch only if still here.
      const wait = fly && fly.by === 'hover' && inAim(p) ? AIM_WAIT_MS : HOVER_OPEN_MS;
      hoverTimer.current = window.setTimeout(() => {
        const tile = headerRefs.current.get(group);
        if (tile?.matches(':hover')) openFly(group, 'hover');
      }, wait);
    },
    onPointerLeaveTile: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!rail || e.pointerType !== 'mouse') return;
      lastPoint.current = { x: e.clientX, y: e.clientY };
      if (hoverTimer.current !== null && fly?.group !== group) {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      if (fly?.group === group && fly.by === 'hover') {
        if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
        const p = { x: e.clientX, y: e.clientY };
        leaveTimer.current = window.setTimeout(() => {
          const box = flyRefs.current.get(group);
          if (box && !box.matches(':hover') && !box.contains(document.activeElement)) closeFly();
        }, inAim(p) ? LEAVE_AIM_MS : LEAVE_MS);
      }
    },
    onPointerEnterFly: () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    },
    onPointerLeaveFly: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rail || e.pointerType !== 'mouse' || fly?.group !== group || fly.by !== 'hover') return;
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        const box = flyRefs.current.get(group);
        const tile = headerRefs.current.get(group);
        if (box && !box.contains(document.activeElement) && !tile?.matches(':hover')) closeFly();
      }, LEAVE_MS);
    },
  });

  const onHeader = (group: FlyKey) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (rail) {
      const byKey = e.detail === 0;
      // A click never closes a list the pointer just opened (KNOWN-ISSUES: hover then click).
      if (fly?.group === group && fly.by !== 'hover') closeFly();
      else openFly(group, byKey ? 'key' : 'click');
      return;
    }
    if (group === 'favourites') return;
    setGroup(group, !open.has(group));
  };

  // The pin opens the full menu with this group open: the panel at ≥ 1280, the overlay at 1024–1279 (§7.2).
  const pin = (group: GroupKey) => () => {
    closeFly();
    setGroup(group, true, true);
    if (ui.mode === 'rail') ui.toggleRail();
    requestAnimationFrame(() => headerRefs.current.get(group)?.focus({ preventScroll: true }));
  };

  /* ── keyboard (§8): ↑↓ Home End through every row and header; ← opens / enters, → returns / closes (RTL) ── */
  const toChild = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const toParent = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement;
    const flyBox = target.closest<HTMLElement>('[data-fly-panel]');
    if (rail && flyBox && fly) {
      const items = focusablesIn(flyBox);
      const at = items.indexOf(target);
      if (e.key === 'Escape' || e.key === toParent) {
        e.preventDefault();
        e.stopPropagation();
        closeFly(true);
        return;
      }
      const move = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (move !== null && items.length) {
        e.preventDefault();
        items[(move + items.length) % items.length]!.focus();
      }
      return;
    }
    if (e.key === 'Tab' && ui.mode === 'overlay') {
      // The overlay keeps focus inside the panel: Tab wraps from the toggle to the switcher and back (§7.1).
      const list = focusablesIn(asideRef.current);
      const first = list[0];
      const last = list[list.length - 1];
      if (!e.shiftKey && target === last) {
        e.preventDefault();
        first?.focus();
      } else if (e.shiftKey && target === first) {
        e.preventDefault();
        last?.focus();
      }
      return;
    }
    const list = focusablesIn(asideRef.current);
    const at = list.indexOf(target);
    if (at < 0) return;
    const move = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (move !== null) {
      e.preventDefault();
      list[Math.max(0, Math.min(list.length - 1, move))]!.focus();
      return;
    }
    const group = target.dataset.navGroup as FlyKey | undefined;
    if (group) {
      if (rail) {
        if (e.key === toChild) {
          e.preventDefault();
          openFly(group, 'key');
        }
        return;
      }
      if (group === 'favourites') return;
      if (e.key === toChild) {
        e.preventDefault();
        if (!open.has(group)) setGroup(group, true);
        else flyRefs.current.get(group)?.querySelector<HTMLElement>('a[href]')?.focus();
      } else if (e.key === toParent && open.has(group)) {
        e.preventDefault();
        setGroup(group, false);
      }
      return;
    }
    if (e.key === toParent && panel) {
      const owner = target.closest<HTMLElement>('[data-group]');
      const header = owner?.querySelector<HTMLElement>('[data-nav-group]');
      if (header && owner?.dataset.group !== 'favourites') {
        e.preventDefault();
        header.focus();
      }
    }
  }

  // Esc closes an open flyout (pointer-opened, focus elsewhere), then the overlay (§8 order: tooltip first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (fly) {
        closeFly(Boolean(flyRefs.current.get(fly.group)?.contains(document.activeElement)));
        return;
      }
      if (ui.mode === 'overlay') ui.closeOverlay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fly, closeFly, ui]);

  /* ── render ── */
  const shortLabel = (item: ShellItem): string | undefined => {
    switch (item.short) {
      case 'home':
        return t('bar.home');
      case 'queue':
        return ts('queue');
      case 'receiving':
        return t('bar.receive');
      case 'contracts':
        return ts('short.contracts');
      case 'recipes':
        return t('bar.dishes');
      case 'inventory':
        return t('bar.count');
      case 'orders':
        return t('bar.orders');
      default:
        return undefined;
    }
  };
  const labelOf = (item: ShellItem) => (item.key === QUEUE_KEY ? ts('queue') : t(`links.${item.key}`));
  const navigate = () => {
    if (ui.mode === 'overlay') ui.closeOverlay({ restoreFocus: false });
    closeFly();
  };
  const groupWords = (label: string) => ({
    here: ts('here'),
    danger: ts('t2.danger'),
    warn: ts('t2.warn'),
    pin: ts('pin.label', { group: label }),
    pinTitle: ts('pin.title'),
    pinMeaning: ts('pin.meaning', { group: label }),
    groupTip: ts('groupTip'),
  });

  const renderItem = (item: ShellItem, opts: { tile?: boolean; fav?: boolean } = {}) => {
    const label = labelOf(item);
    const look = opts.fav ? null : (looks.get(item.key) ?? null);
    const value = valueOf(item.key);
    const chord = ui.singleKeys ? CHORDS.get(item.href) : undefined;
    const bw = opts.fav ? null : badgeWordsFor(look ? value : undefined, locale, words);
    return (
      <li key={`${opts.fav ? 'fav-' : ''}${item.key}`}>
        <NavItem
          itemKey={item.key}
          href={item.href}
          label={label}
          short={shortLabel(item)}
          tile={opts.tile}
          active={!opts.fav && item.key === activeKey}
          look={look}
          tone={value?.tone}
          badgeWords={bw}
          viewOnly={item.viewOnly ? ts('viewOnly') : null}
          locale={locale}
          tip={opts.tile ? { title: label, kbd: chord, text: bw ?? undefined } : null}
          onNavigate={navigate}
        />
      </li>
    );
  };

  const renderGroup = (group: GroupKey, items: ShellItem[]) => {
    const label = t(`groups.${group}`);
    return (
      <NavGroup
        key={group}
        group={group}
        label={label}
        open={open.has(group)}
        flyOpen={fly?.group === group}
        rail={rail}
        here={activeGroup === group}
        dot={groupDot(items.map((i) => i.key), looks)}
        words={groupWords(label)}
        flyTop={fly?.group === group ? flyTop : null}
        onHeader={onHeader(group)}
        onPin={pin(group)}
        headerRef={(el) => {
          if (el) headerRefs.current.set(group, el);
          else headerRefs.current.delete(group);
        }}
        flyRef={(el) => {
          if (el) flyRefs.current.set(group, el);
          else flyRefs.current.delete(group);
        }}
        {...tileHandlers(group)}
      >
        {items.map((i) => renderItem(i))}
      </NavGroup>
    );
  };

  const ToggleIcon = dir === 'rtl' ? (rail ? PanelRightOpen : PanelRightClose) : rail ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = ui.mode === 'overlay' ? ts('toggle.closeOverlay') : rail ? t('shell.expand') : t('shell.collapse');
  const SearchIcon = UTILITY_ICONS.search;
  const HelpIcon = UTILITY_ICONS.help;

  return (
    <aside ref={asideRef} aria-label={ts('aside')} className={css.side} data-testid="sidebar" onKeyDown={onKeyDown}>
      <div className={css.inner}>
        <div className={css.head}>
          {switcher ?? (
            <div className={css.headBtn}>
              <span aria-hidden="true" className={cn(css.mono, 'text-xs font-bold leading-4')}>
                {restaurantName.trim().charAt(0) || 'R'}
              </span>
              <span className={css.headText}>
                <span className="truncate text-sm font-semibold leading-[18px] text-ink">{restaurantName}</span>
                <span className="truncate text-xs leading-4 text-subtle">{subline}</span>
              </span>
            </div>
          )}
        </div>
        <div className={css.cmdk}>
          <button
            type="button"
            className={cn(css.cmdkBtn, 'text-sm leading-5')}
            onClick={() => ui.openPalette()}
            aria-keyshortcuts="Control+K Meta+K"
            data-testid="sidebar-cmdk"
          >
            <span className={css.ic}>
              <SearchIcon aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
            </span>
            <span className={css.cmdkLab}>{ts('search.field')}</span>
            <kbd dir="ltr" aria-hidden="true" className={cn(css.kbd, 'font-sans text-xs font-medium leading-4 text-muted')}>
              Ctrl K
            </kbd>
          </button>
        </div>
        <nav aria-label={t('mainLabel')} className={css.nav}>
          <div
            ref={scrollRef}
            className={cn(css.scroll, clip.t && css.clipT, clip.b && css.clipB)}
            data-testid="sidebar-groups"
            onScroll={measureClip}
          >
            <ul className={cn(css.list, css.top)}>
              <li>
                <button
                  type="button"
                  className={cn(css.item, css.tile, css.searchTile, 'text-sm font-medium leading-5')}
                  onClick={() => ui.openPalette()}
                  aria-keyshortcuts="Control+K Meta+K"
                  data-tip={ts('search.field')}
                  data-tip-kbd="Ctrl K"
                  data-tip-when="rail"
                >
                  <span className={css.ic}>
                    <NavIcon icon={SearchIcon} />
                  </span>
                  <span className={css.lab}>{ts('search.field')}</span>
                  <span aria-hidden="true" className={cn(css.short, 'text-xs font-medium leading-4')}>
                    {ts('search.tile')}
                  </span>
                </button>
              </li>
              {model.top.map((item) => renderItem(item, { tile: true }))}
            </ul>
            {!flat && favItems.length > 0 ? (
              <NavGroup
                group="favourites"
                label={ts('favourites')}
                open
                flyOpen={fly?.group === 'favourites'}
                rail={rail}
                here={false}
                dot={null}
                fav
                words={groupWords(ts('favourites'))}
                flyTop={fly?.group === 'favourites' ? flyTop : null}
                onHeader={onHeader('favourites')}
                headerRef={(el) => {
                  if (el) headerRefs.current.set('favourites', el);
                  else headerRefs.current.delete('favourites');
                }}
                flyRef={(el) => {
                  if (el) flyRefs.current.set('favourites', el);
                  else flyRefs.current.delete('favourites');
                }}
                {...tileHandlers('favourites')}
              >
                {favItems.map((i) => renderItem(i, { fav: true }))}
              </NavGroup>
            ) : null}
            {!flat && model.groups.length > 0 ? <div className={css.gap} aria-hidden="true" /> : null}
            {model.groups.map((g) => renderGroup(g.group, g.items))}
          </div>
          <div className={css.foot}>
            {model.footer.map((g) => renderGroup(g.group, g.items))}
            <ul className={cn(css.list, css.help, 'text-xs leading-4')} aria-label={t('shell.support')} data-testid="support-links-sidebar">
              {SUPPORT_LINKS.map((l) => {
                const Icon = UTILITY_ICONS[l.icon];
                // A short visible word where the full name is long; the accessible name keeps the full words,
                // which contain the visible ones (label in name, WCAG 2.5.3).
                const full = t(`shell.${l.key}`);
                const shown = l.key === 'help' ? full : ts(`short.${l.key}`);
                return (
                  <li key={l.key}>
                    <Link
                      href={l.href}
                      prefetch={false}
                      className={css.helpLink}
                      aria-label={shown === full ? undefined : full}
                    >
                      <Icon aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
                      <span className={css.helpText}>{shown}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <ul className={css.list}>
              <li>
                <Link
                  href={SUPPORT_LINKS[0].href}
                  prefetch={false}
                  className={cn(css.item, css.tile, css.helpTile, 'text-sm font-medium leading-5')}
                  data-tip={t('shell.support')}
                  data-tip-when="rail"
                >
                  <span className={css.ic}>
                    <NavIcon icon={HelpIcon} />
                  </span>
                  <span className={css.lab}>{t('shell.support')}</span>
                  <span aria-hidden="true" className={cn(css.short, 'text-xs font-medium leading-4')}>
                    {t('shell.help')}
                  </span>
                </Link>
              </li>
            </ul>
          </div>
        </nav>
        <div className={css.user}>
          <AccountMenu
            userName={userName}
            email={email}
            roleLabel={roleLabel}
            isPlatformAdmin={isPlatformAdmin}
            receiverLangs={receiverLangs}
            logout={logout}
          />
          {flat ? null : (
            <button
              ref={(el) => {
                ui.toggleRef.current = el;
              }}
              type="button"
              className={css.ib}
              onClick={ui.toggleRail}
              aria-label={toggleLabel}
              aria-expanded={ui.mode === 'overlay' || ui.mode === 'panel'}
              aria-keyshortcuts="Control+B Meta+B"
              data-testid="sidebar-toggle"
              data-tip={toggleLabel}
              data-tip-kbd="Ctrl B"
              data-tip-text={ui.mode === 'overlay' ? undefined : ts('toggle.meaning')}
            >
              <ToggleIcon aria-hidden="true" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {flat ? null : <span aria-hidden="true" className={css.edge} onClick={ui.toggleRail} />}
    </aside>
  );
}
