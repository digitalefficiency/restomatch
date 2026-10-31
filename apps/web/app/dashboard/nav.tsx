'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, X } from 'lucide-react';
import { cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { originalProps } from '@/lib/i18n/original';
import { nav } from '@/lib/i18n/messages/nav';
import {
  activeNavKey,
  barItems,
  crumbsFor,
  defaultOpenGroups,
  footerGroups,
  isFieldPath,
  mainGroups,
  moreGroups,
  type GroupKey,
  type NavGroup,
  type NavViewer,
  type RouteDef,
} from '@/lib/nav';
import { iconFor } from '@/lib/nav/icons';
import { GROUPS_STORAGE, RAIL_COOKIE, RAIL_STORAGE } from '@/lib/nav/prefs';
import { DashboardSearch } from './search';

/* ───────────────────────────── shared shell state ───────────────────────────── */


/** Help, accessibility statement and contact: same place on every shell (ia-nav-20). */
export const SUPPORT_LINKS = [
  { key: 'help', href: '/accessibility#help' }, // PLACEHOLDER until a help page exists (owner decision #3)
  { key: 'accessibility', href: '/accessibility' }, // the statement page itself ships in W1-12
  { key: 'contact', href: '/accessibility#contact' }, // PLACEHOLDER until contact channels are set (owner decision #3)
] as const;

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

interface ShellUi {
  rail: boolean;
  toggleRail: () => void;
  moreOpen: boolean;
  openMore: (opener?: HTMLElement | null) => void;
  closeMore: () => void;
  searchOpen: boolean;
  openSearch: (opener?: HTMLElement | null) => void;
  closeSearch: () => void;
}

const ShellUiContext = createContext<ShellUi | null>(null);
// Cast like the other providers: two @types/react copies (see lib/i18n/client.tsx).
const ShellUiProvider = ShellUiContext.Provider as unknown as React.ComponentType<{
  value: ShellUi | null;
  children: React.ReactNode;
}>;

function useShellUi(): ShellUi {
  const ctx = useContext(ShellUiContext);
  if (!ctx) throw new Error('ShellFrame missing');
  return ctx;
}

function persist(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / blocked storage: the cookie still carries the rail */
  }
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Focus the element that opened an overlay, if it is still in the page. */
function restoreFocus(el: HTMLElement | null) {
  if (el && document.contains(el)) el.focus({ preventScroll: true });
}

/**
 * The app frame: publishes the chrome variables, owns the rail and overlay
 * state, and binds Ctrl/⌘+B (by `KeyboardEvent.code`, so it works on a Hebrew
 * layout) to the sidebar rail. `initialRail` comes from the cookie so the
 * server renders the sidebar at its final width.
 */
export function ShellFrame({ initialRail, children }: { initialRail: boolean; children: React.ReactNode }) {
  const [rail, setRail] = useState(initialRail);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const toggleRail = useCallback(() => {
    setRail((r) => {
      const next = !r;
      try {
        document.cookie = `${RAIL_COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        /* cookies blocked: the choice lives for this page only */
      }
      persist(RAIL_STORAGE, next ? '1' : '0');
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyB' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      e.preventDefault();
      toggleRail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  const value: ShellUi = {
    rail,
    toggleRail,
    moreOpen,
    openMore: (opener) => {
      openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
      setSearchOpen(false);
      setMoreOpen(true);
    },
    closeMore: () => {
      setMoreOpen(false);
      const opener = openerRef.current;
      requestAnimationFrame(() => restoreFocus(opener));
    },
    searchOpen,
    openSearch: (opener) => {
      // Opened from the "עוד" sheet: focus returns to its opener ("עוד") afterwards.
      if (!moreOpen) openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
      setMoreOpen(false);
      setSearchOpen(true);
    },
    closeSearch: () => {
      setSearchOpen(false);
      const opener = openerRef.current;
      requestAnimationFrame(() => restoreFocus(opener));
    },
  };

  return (
    <ShellUiProvider value={value}>
      <div
        id="rm-app"
        data-rail={rail ? 'on' : 'off'}
        className="min-h-screen"
        style={{ ['--rm-sidebar-w' as string]: rail ? '64px' : '248px' }}
      >
        {children}
      </div>
    </ShellUiProvider>
  );
}

/** Tab / Shift+Tab wrap inside an open dialog, so focus never leaves it (not even to the browser chrome). */
function useFocusWrap(open: boolean, getRoot: () => HTMLElement | null) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = getRoot();
      if (!root) return;
      const focusables = [
        ...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, getRoot]);
}

/** While an overlay is open, everything behind it is `inert` (no Tab stop escapes it). */
function useInertApp(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const app = document.getElementById('rm-app');
    const skip = document.querySelector<HTMLElement>('[data-rm-skip-link]');
    app?.setAttribute('inert', '');
    skip?.setAttribute('inert', '');
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      app?.removeAttribute('inert');
      skip?.removeAttribute('inert');
      document.body.style.overflow = prev;
    };
  }, [open]);
}

/* ───────────────────────────── badges ───────────────────────────── */

/** Per-key nav badges the layout already knows (W1: the open price-alert count on contracts). */
export type NavBadges = Partial<Record<string, number>>;

function NavBadge({ count, dot = false }: { count?: number; dot?: boolean }) {
  const locale = useLocale();
  if (!count || count <= 0) return null;
  if (dot) {
    return <span aria-hidden="true" className="absolute end-1 top-1 h-2 w-2 rounded-full bg-ink/70 ring-2 ring-surface" />;
  }
  // Neutral: a price alert is not a block (exec-desktop-20); danger is reserved for blocking items.
  return (
    <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-2 px-1.5 text-xs font-semibold tabular-nums text-ink ring-1 ring-line">
      {count > 99 ? `${formatNumber(99, locale)}+` : formatNumber(count, locale)}
    </span>
  );
}

/* ───────────────────────────── desktop sidebar ───────────────────────────── */

function SidebarItem({
  def,
  active,
  rail,
  badge,
  label,
}: {
  def: RouteDef;
  active: boolean;
  rail: boolean;
  badge?: number;
  label: string;
}) {
  const Icon = iconFor(def.key);
  return (
    <li>
      <Link
        href={def.path}
        aria-current={active ? 'page' : undefined}
        title={rail ? label : undefined}
        className={cn(
          'relative flex h-9 items-center gap-2.5 rounded-lg text-sm transition-colors',
          rail ? 'justify-center px-0' : 'ps-3 pe-2',
          focusRing,
          active ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
        )}
      >
        {/* 3 px inline-start indicator: the active state never relies on colour alone. */}
        {active ? <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-primary" /> : null}
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className={rail ? 'sr-only' : 'min-w-0 truncate'}>{label}</span>
        <NavBadge count={badge} dot={rail} />
      </Link>
    </li>
  );
}

function SidebarGroup({
  group,
  open,
  onToggle,
  rail,
  activeKey,
  badges,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  rail: boolean;
  activeKey?: string;
  badges: NavBadges;
}) {
  const t = useT(nav) as unknown as (key: string) => string;
  const listId = `rm-nav-group-${group.group}`;
  const items = (
    <ul id={listId} className="space-y-0.5" aria-label={rail || group.group === 'top' ? t(`groups.${group.group}`) : undefined}>
      {group.items.map((d) => (
        <SidebarItem
          key={d.key}
          def={d}
          active={d.key === activeKey}
          rail={rail}
          badge={badges[d.key]}
          label={t(`links.${d.key}`)}
        />
      ))}
    </ul>
  );
  // The flat top group, a single-item group and the rail render without a header.
  if (group.group === 'top' || rail || group.items.length === 1) {
    // A flat non-top item gets a hairline so it never reads as part of the group above.
    return <div className={cn(group.group !== 'top' && 'border-t border-line pt-2')}>{items}</div>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'flex h-8 w-full items-center justify-between rounded-md ps-3 pe-2 text-xs font-semibold text-subtle hover:text-ink',
          focusRing,
        )}
      >
        {t(`groups.${group.group}`)}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && 'ltr:-rotate-90 rtl:rotate-90')} aria-hidden="true" />
      </button>
      <div hidden={!open}>{items}</div>
    </div>
  );
}

/**
 * Desktop (≥1024) sidebar on the inline-start edge: 248 px, or a 64 px rail.
 * Job-ordered groups from the nav registry, collapsible (persisted), with the
 * admin group, help and the accessibility statement pinned to the footer.
 */
export function Sidebar({
  viewer,
  badges,
  restaurantName,
  roleLabel,
}: {
  viewer: NavViewer;
  badges: NavBadges;
  restaurantName: string;
  roleLabel: string;
}) {
  const t = useT(nav);
  const pathname = usePathname();
  const { rail, toggleRail } = useShellUi();
  const activeKey = activeNavKey(pathname);
  const groups = mainGroups(viewer);
  const footer = footerGroups(viewer);
  const [open, setOpen] = useState<Set<GroupKey>>(() => new Set(defaultOpenGroups()));

  useEffect(() => {
    const stored = readStored(GROUPS_STORAGE);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as Partial<Record<GroupKey, boolean>>;
      setOpen((prev) => {
        const next = new Set(prev);
        for (const [g, isOpen] of Object.entries(parsed)) {
          if (isOpen) next.add(g as GroupKey);
          else next.delete(g as GroupKey);
        }
        return next;
      });
    } catch {
      /* corrupt value: keep the defaults */
    }
  }, []);

  const toggle = (g: GroupKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      const stored: Partial<Record<GroupKey, boolean>> = {};
      for (const k of [...groups, ...footer].map((x) => x.group)) stored[k] = next.has(k);
      persist(GROUPS_STORAGE, JSON.stringify(stored));
      return next;
    });

  // The group holding the current page is always open.
  const isOpen = (g: NavGroup) => open.has(g.group) || g.items.some((d) => d.key === activeKey);
  const RailIcon = rail ? PanelLeftOpen : PanelLeftClose;

  return (
    <div
      data-testid="sidebar"
      className="fixed inset-y-0 start-0 z-40 hidden w-[var(--rm-sidebar-w)] flex-col border-e border-line bg-surface lg:flex"
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-line', rail ? 'justify-center px-2' : 'px-4')}>
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-on-primary"
        >
          {restaurantName.trim().charAt(0) || 'R'}
        </span>
        <div className={rail ? 'sr-only' : 'min-w-0'}>
          <p className="truncate text-sm font-bold text-ink">
            <span {...originalProps(restaurantName)}>{restaurantName}</span>
          </p>
          <p className="truncate text-xs text-subtle">{roleLabel}</p>
        </div>
      </div>
      <nav aria-label={t('mainLabel')} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-3" data-testid="sidebar-groups">
          {groups.map((g) => (
            <SidebarGroup
              key={g.group}
              group={g}
              open={isOpen(g)}
              onToggle={() => toggle(g.group)}
              rail={rail}
              activeKey={activeKey}
              badges={badges}
            />
          ))}
        </div>
        <div className="shrink-0 space-y-1 border-t border-line px-2 py-2">
          {footer.map((g) => (
            <SidebarGroup
              key={g.group}
              group={g}
              open={isOpen(g)}
              onToggle={() => toggle(g.group)}
              rail={rail}
              activeKey={activeKey}
              badges={badges}
            />
          ))}
          <SupportLinks variant={rail ? 'rail' : 'sidebar'} />
          <button
            type="button"
            onClick={toggleRail}
            aria-pressed={rail}
            aria-keyshortcuts="Control+B Meta+B"
            title={t('shell.keyboardHint')}
            className={cn(
              'flex h-9 w-full items-center gap-2.5 rounded-lg text-sm text-muted hover:bg-surface-2 hover:text-ink',
              rail ? 'justify-center' : 'ps-3',
              focusRing,
            )}
          >
            <RailIcon className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
            <span className={rail ? 'sr-only' : ''}>{rail ? t('shell.expand') : t('shell.collapse')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

/** "עזרה · הצהרת נגישות · צור קשר" — the same links, the same place, on every dashboard route. */
export function SupportLinks({ variant }: { variant: 'sidebar' | 'rail' | 'sheet' }) {
  const t = useT(nav) as unknown as (key: string) => string;
  if (variant === 'rail') {
    return (
      <Link
        href="/accessibility"
        prefetch={false}
        title={t('shell.support')}
        className={cn('flex h-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink', focusRing)}
      >
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{t('shell.support')}</span>
      </Link>
    );
  }
  return (
    <ul
      aria-label={t('shell.support')}
      data-testid={`support-links-${variant}`}
      className={cn(
        'flex flex-wrap items-center text-xs text-muted',
        variant === 'sidebar' ? 'gap-x-3 gap-y-1 px-3 py-1' : 'gap-x-4 gap-y-2',
      )}
    >
      {SUPPORT_LINKS.map((l) => (
        <li key={l.key}>
          <Link
            href={l.href}
            // Public pages outside the app shell, rarely opened: no prefetch on every dashboard load.
            prefetch={false}
            className={cn(
              'inline-flex items-center rounded hover:text-ink hover:underline',
              variant === 'sheet' ? 'min-h-11 min-w-11 justify-center px-1' : 'min-h-6',
              focusRing,
            )}
          >
            {t(`shell.${l.key}`)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── top bar pieces ───────────────────────────── */

/** Desktop top-bar breadcrumb from the registry; crumbs the viewer can't open are plain text. */
export function TopCrumbs({ viewer }: { viewer: NavViewer }) {
  const t = useT(nav) as unknown as (key: string) => string;
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname, viewer.role);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={t('shell.breadcrumbs')} className="hidden min-w-0 lg:block" data-testid="top-crumbs">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.key} className="flex min-w-0 items-center gap-1">
              {last ? (
                <span aria-current="page" className="truncate font-semibold text-ink">
                  {t(`links.${c.key}`)}
                </span>
              ) : c.href ? (
                <Link href={c.href} className={cn('truncate rounded text-muted hover:text-ink', focusRing)}>
                  {t(`links.${c.key}`)}
                </Link>
              ) : (
                <span className="truncate text-muted">{t(`links.${c.key}`)}</span>
              )}
              {!last ? <ChevronRight className="h-4 w-4 shrink-0 text-subtle rtl:-scale-x-100" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Phone top bar 🔍 (44×44): opens the full-screen search sheet. */
export function MobileSearchButton() {
  const t = useT(nav);
  const { openSearch, searchOpen } = useShellUi();
  return (
    <button
      type="button"
      onClick={(e) => openSearch(e.currentTarget)}
      aria-label={t('shell.openSearch')}
      aria-expanded={searchOpen}
      aria-controls="dashboard-search-sheet"
      className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink hover:bg-surface-2 lg:hidden', focusRing)}
    >
      <Search className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** Full-screen search on the phone (the desktop search lives in the top bar). */
export function SearchSheet({ role }: { role: NavViewer['role'] }) {
  const t = useT(nav);
  const { searchOpen, closeSearch } = useShellUi();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useInertApp(searchOpen);
  const ref = useRef<HTMLDivElement>(null);
  useFocusWrap(searchOpen, useCallback(() => ref.current, []));

  useEffect(() => {
    if (!searchOpen) return;
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchOpen, closeSearch]);

  if (!mounted || !searchOpen) return null;
  return <>{createPortal(
    <div
      ref={ref}
      id="dashboard-search-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={t('search.label')}
      className="fixed inset-0 z-50 flex flex-col bg-surface pt-[env(safe-area-inset-top)]"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <DashboardSearch role={role} variant="drawer" className="flex-1" onNavigate={closeSearch} />
        <button
          type="button"
          onClick={closeSearch}
          aria-label={t('shell.closeSearch')}
          className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:text-ink', focusRing)}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  )}</>;
}

/**
 * Account menu (avatar): who is signed in, settings, the platform console for
 * platform admins, and sign-out. A disclosure (button + panel), not an ARIA
 * menu. The panel stays in the DOM while closed (`hidden`), so the e-mail is
 * out of the visible chrome but still names the session.
 */
export function AvatarMenu({
  email,
  roleLabel,
  restaurantName,
  isPlatformAdmin,
  logout,
}: {
  email: string;
  roleLabel: string;
  restaurantName: string;
  isPlatformAdmin: boolean;
  logout: () => Promise<void>;
}) {
  const t = useT(nav);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Fixed id, not useId() (see DashboardSearch): one account menu per page.
  const panelId = 'rm-account-panel';
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (email.trim().charAt(0) || '?').toUpperCase();
  const itemClass = cn('flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-ink hover:bg-surface-2', focusRing);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('menu.account')}
        data-testid="avatar-menu"
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-full lg:h-9 lg:w-9',
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/12 text-sm font-bold text-primary"
        >
          {initial}
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute end-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-card"
      >
        <div className="border-b border-line px-3 pb-2 pt-1.5">
          <p className="truncate text-sm font-semibold text-ink" dir="ltr" style={{ textAlign: 'start' }}>
            {email}
          </p>
          <p className="truncate text-xs text-subtle">
            {roleLabel}
            <span aria-hidden="true"> · </span>
            <span {...originalProps(restaurantName)}>{restaurantName}</span>
          </p>
        </div>
        <ul className="py-1">
          <li>
            <Link href="/dashboard/settings" className={itemClass}>
              <Settings className="h-4 w-4 text-muted" aria-hidden="true" />
              {t('links.settings')}
            </Link>
          </li>
          {isPlatformAdmin ? (
            <li>
              <Link href="/admin" className={itemClass}>
                <ShieldCheck className="h-4 w-4 text-muted" aria-hidden="true" />
                {t('shell.platformAdmin')}
              </Link>
            </li>
          ) : null}
          <li>
            <form action={logout} data-rm-logout="">
              <button type="submit" className={itemClass}>
                <LogOut className="h-4 w-4 text-muted rtl:-scale-x-100" aria-hidden="true" />
                {t('signOut')}
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ───────────────────────────── phone bottom bar ───────────────────────────── */

/** On-screen keyboard heuristic: the visual viewport shrank by more than 150 px. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let max = vv.height;
    let width = vv.width;
    const onResize = () => {
      if (Math.abs(vv.width - width) > 1) {
        // Rotation: start a new baseline.
        width = vv.width;
        max = vv.height;
      }
      max = Math.max(max, vv.height);
      setOpen(max - vv.height > 150);
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  return open;
}

/**
 * Phone bottom bar (<1024): the role's 4 registry slots + "עוד". Server-
 * rendered (no portal: the header has no backdrop-filter, so `fixed` works in
 * place), 64 px + the safe area, solid surface, 12 px labels that never
 * truncate. Hidden on field routes and while the on-screen keyboard is open;
 * the shell publishes `--rm-bottomnav-h` accordingly.
 */
export function BottomBar({ viewer, badges }: { viewer: NavViewer; badges: NavBadges }) {
  const t = useT(nav) as unknown as (key: string) => string;
  const pathname = usePathname();
  const { moreOpen, openMore } = useShellUi();
  const keyboard = useKeyboardOpen();
  const field = isFieldPath(pathname);
  const hidden = field || keyboard;
  const activeKey = activeNavKey(pathname);
  const items = barItems(viewer);
  const inBar = items.some((b) => b.def.key === activeKey);

  useEffect(() => {
    document.documentElement.dataset.rmBar = hidden ? 'off' : 'on';
    return () => {
      delete document.documentElement.dataset.rmBar;
    };
  }, [hidden]);

  const slot = 'flex flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs leading-4';
  const pill = 'relative inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors';

  return (
    <nav
      aria-label={t('mobileLabel')}
      hidden={hidden}
      data-testid="bottom-bar"
      // Lifted above the cookie banner while it is shown (ConsentClearance).
      className="fixed inset-x-0 bottom-[var(--consent-h,0px)] z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex h-16 max-w-lg items-stretch">
        {items.map(({ def, label }) => {
          const active = def.key === activeKey;
          const Icon = iconFor(def.key);
          return (
            <li key={def.key} className="flex min-w-0 flex-1">
              <Link
                href={def.path}
                aria-current={active ? 'page' : undefined}
                className={cn(slot, focusRing, active ? 'font-semibold text-primary' : 'text-muted hover:text-ink')}
              >
                <span className={cn(pill, active && 'bg-primary/12')}>
                  <Icon className="h-6 w-6" aria-hidden="true" />
                  <NavBadge count={badges[def.key]} dot />
                </span>
                <span className="max-w-full whitespace-nowrap">{t(`bar.${label}`)}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => openMore(e.currentTarget)}
            aria-expanded={moreOpen}
            aria-controls="dashboard-drawer"
            className={cn(
              slot,
              'w-full',
              focusRing,
              // Pages that live in "עוד" light it up, so the bar always shows where you are.
              !inBar && activeKey ? 'font-semibold text-primary' : 'text-muted hover:text-ink',
            )}
          >
            <span className={cn(pill, !inBar && activeKey && 'bg-primary/12')}>
              <MoreHorizontal className="h-6 w-6" aria-hidden="true" />
            </span>
            <span className="whitespace-nowrap">{t('bar.more')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/* ───────────────────────────── "עוד" sheet ───────────────────────────── */

/**
 * "עוד" bottom sheet (replaces the ☰ drawer): search, the branch list, every
 * nav item not in the bar as a grouped 2-column tile grid, then profile,
 * help and sign-out. Modal: the app behind it is `inert`, Esc closes, focus
 * returns to the opener.
 */
export function MoreSheet({
  viewer,
  badges,
  branchList,
  language,
  logout,
}: {
  viewer: NavViewer;
  badges: NavBadges;
  /** The branch switcher (list variant) for users with ≥2 memberships. */
  branchList?: React.ReactNode;
  /** The language control (picker or עב/EN toggle). */
  language: React.ReactNode;
  logout: () => Promise<void>;
}) {
  const t = useT(nav) as unknown as (key: string) => string;
  const pathname = usePathname();
  const { moreOpen, closeMore, openSearch } = useShellUi();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useInertApp(moreOpen);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusWrap(moreOpen, useCallback(() => document.getElementById('dashboard-drawer'), []));
  const activeKey = activeNavKey(pathname);
  const groups = moreGroups(viewer);
  const titleId = 'dashboard-drawer-title';

  // Close on navigation.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && moreOpen) closeMore();
    lastPath.current = pathname;
  }, [pathname, moreOpen, closeMore]);

  useEffect(() => {
    if (!moreOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMore();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen, closeMore]);

  if (!mounted || !moreOpen) return null;
  return <>{createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-ink/40" onClick={closeMore} />
      <div
        id="dashboard-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-card"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <h2 id={titleId} className="text-base font-bold text-ink">
            {t('bar.more')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={closeMore}
            aria-label={t('menu.close')}
            className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-ink', focusRing)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <button
            type="button"
            onClick={() => openSearch()}
            className={cn(
              'mb-4 flex min-h-12 w-full items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 text-start text-sm text-subtle',
              focusRing,
            )}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('shell.openSearch')}
          </button>
          {branchList ? <div className="mb-4 rounded-xl border border-line py-2">{branchList}</div> : null}
          <nav aria-label={t('mainLabel')}>
            {groups.map((g) => (
              <section key={g.group} className="mb-4" aria-labelledby={`more-${g.group}`}>
                <h3 id={`more-${g.group}`} className="mb-2 text-xs font-semibold text-subtle">
                  {t(`groups.${g.group}`)}
                </h3>
                <ul className="grid grid-cols-2 gap-2">
                  {g.items.map((d) => {
                    const Icon = iconFor(d.key);
                    const active = d.key === activeKey;
                    return (
                      <li key={d.key}>
                        <Link
                          href={d.path}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2 text-sm',
                            focusRing,
                            active
                              ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                              : 'border-line text-ink hover:bg-surface-2',
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                          <span className="min-w-0 flex-1 break-words leading-5">{t(`links.${d.key}`)}</span>
                          <NavBadge count={badges[d.key]} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
          <section aria-labelledby="more-profile" className="border-t border-line pt-4">
            <h3 id="more-profile" className="mb-2 text-xs font-semibold text-subtle">
              {t('shell.profile')}
            </h3>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{t('shell.language')}</span>
              {language}
            </div>
            <SupportLinks variant="sheet" />
            <form action={logout} data-rm-logout="" className="mt-3">
              <button
                type="submit"
                className={cn(
                  'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold text-ink hover:bg-surface-2',
                  focusRing,
                )}
              >
                <LogOut className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                {t('signOut')}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )}</>;
}
