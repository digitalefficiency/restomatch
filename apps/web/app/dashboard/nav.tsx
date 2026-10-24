'use client';

import { useEffect, useRef, useState } from 'react';
import { originalProps } from '@/lib/i18n/original';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  ChefHat,
  FileDown,
  FileSignature,
  FileText,
  HandCoins,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Network,
  Store,
  MoreHorizontal,
  PackageCheck,
  Settings,
  Sparkles,
  ShoppingCart,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import type { FeatureKey } from '@restomatch/api';
import { cn } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { LanguagePicker } from '@/lib/i18n/LanguagePicker';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { nav } from '@/lib/i18n/messages/nav';
import { canSeeRoute } from '@/lib/roles';
import { DashboardSearch } from './search';

type LinkKey =
  | 'overview'
  | 'receiving'
  | 'approvals'
  | 'inbox'
  | 'leaks'
  | 'chain'
  | 'recovery'
  | 'monthlyReport'
  | 'ask'
  | 'suppliers'
  | 'catalog'
  | 'contracts'
  | 'orders'
  | 'recipes'
  | 'exports'
  | 'team'
  | 'branches'
  | 'settings';
type GroupKey = 'operations' | 'purchasing' | 'admin';

interface NavItem {
  key: LinkKey;
  href: string;
  icon: LucideIcon;
  group: GroupKey;
  /** Wave-1 contracts/priceAlerts entry: shown only when the layout says a flag is on. */
  wave1?: boolean;
  /** Wave-1 per-restaurant flag: the item is hidden unless the flag is on. */
  feature?: string;
  /** Wave-1 flag(s): the item shows only when one of them is enabled. */
  features?: FeatureKey[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/dashboard', icon: LayoutDashboard, group: 'operations' },
  { key: 'receiving', href: '/dashboard/receiving', icon: PackageCheck, group: 'operations' },
  { key: 'approvals', href: '/dashboard/approvals', icon: Inbox, group: 'operations' },
  {
    key: 'inbox',
    href: '/dashboard/inbox',
    icon: Mail,
    group: 'operations',
    features: ['ingestWhatsapp', 'ingestEmail'],
  },
  { key: 'leaks', href: '/dashboard/leaks', icon: BarChart3, group: 'operations' },
  { key: 'chain', href: '/dashboard/chain', icon: Network, group: 'operations' },
  { key: 'recovery', href: '/dashboard/recovery', icon: HandCoins, group: 'operations', feature: 'recovery' },
  {
    key: 'monthlyReport',
    href: '/dashboard/reports/monthly',
    icon: FileText,
    group: 'operations',
    feature: 'monthlyReport',
  },
  { key: 'ask', href: '/dashboard/ask', icon: Sparkles, group: 'operations', feature: 'aiAssistant' },
  { key: 'suppliers', href: '/dashboard/suppliers', icon: Truck, group: 'purchasing' },
  { key: 'catalog', href: '/dashboard/catalog', icon: Boxes, group: 'purchasing' },
  { key: 'contracts', href: '/dashboard/contracts', icon: FileSignature, group: 'purchasing', wave1: true },
  { key: 'orders', href: '/dashboard/orders', icon: ShoppingCart, group: 'purchasing' },
  { key: 'recipes', href: '/dashboard/recipes', icon: ChefHat, group: 'purchasing', feature: 'recipes' },
  { key: 'exports', href: '/dashboard/exports', icon: FileDown, group: 'admin' },
  { key: 'team', href: '/dashboard/team', icon: Users, group: 'admin' },
  { key: 'branches', href: '/dashboard/branches', icon: Store, group: 'admin' },
  { key: 'settings', href: '/dashboard/settings', icon: Settings, group: 'admin' },
];

const GROUPS: GroupKey[] = ['operations', 'purchasing', 'admin'];

/** Products live under the catalog; treat their detail pages as "catalog" in the nav. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  if (href === '/dashboard/catalog' && pathname.startsWith('/dashboard/products')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Wave-1 nav state from the layout: contracts/priceAlerts flag on (+ finance role) and the open-alert count. */
export interface Wave1Nav {
  visible: boolean;
  badge: number;
}

/**
 * `showChain`: owners who run more than one branch get the Chain tab (branch
 * management is then one click away in the branch switcher and on the chain
 * page); single-branch owners get the Branches tab instead (open a branch /
 * see the chain plan). One of the two, so the tab row still fits.
 * `features`: wave-1 per-restaurant flags; an item with `feature` is hidden unless it is on,
 * an item with `features` shows only when one of them is on.
 */
function visibleItems(
  role: UserRole,
  showChain = false,
  features: readonly string[] = [],
  wave1?: Wave1Nav,
): NavItem[] {
  return NAV_ITEMS.filter(
    ({ key, href, feature, features: anyOf, wave1: gated }) =>
      canSeeRoute(role, href) &&
      (key !== 'chain' || showChain) &&
      (key !== 'branches' || !showChain) &&
      (!feature || features.includes(feature)) &&
      (!anyOf || anyOf.some((f) => features.includes(f))) &&
      (!gated || wave1?.visible === true),
  );
}

/** Small open-alert count pill next to the contracts entry. */
function NavBadge({ itemKey, wave1 }: { itemKey: LinkKey; wave1?: Wave1Nav }) {
  const locale = useLocale();
  if (itemKey !== 'contracts' || !wave1 || wave1.badge <= 0) return null;
  return (
    <span className="ms-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger/15 px-1.5 text-[10px] font-bold tabular-nums text-danger ring-1 ring-danger/30">
      {wave1.badge > 99 ? `${formatNumber(99, locale)}+` : formatNumber(wave1.badge, locale)}
    </span>
  );
}

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Desktop (lg+) primary nav: a calm row of tabs under the top bar, grouped
 * with hairline separators. With the wave-1 flags on an owner has ~17 tabs —
 * wider than the max-w-6xl header at every viewport — so the row WRAPS onto a
 * second line instead of scrolling: a hidden-scrollbar overflow clipped
 * Settings/Team/Contracts (even the active tab) with no cue they existed.
 */
export function DesktopNav({
  role,
  showChain = false,
  features,
  wave1,
}: {
  role: UserRole;
  showChain?: boolean;
  features?: readonly string[];
  wave1?: Wave1Nav;
}) {
  const t = useT(nav);
  const pathname = usePathname();
  const items = visibleItems(role, showChain, features, wave1);
  return (
    <nav aria-label={t('mainLabel')} className="hidden lg:block">
      <ul className="-mb-px flex flex-wrap items-stretch gap-x-1 text-sm" data-testid="desktop-nav-row">
        {GROUPS.map((g, gi) => {
          const groupItems = items.filter((i) => i.group === g);
          if (groupItems.length === 0) return null;
          return (
            <li key={g} className="flex min-w-0 max-w-full items-stretch gap-1">
              {gi > 0 ? <span aria-hidden="true" className="my-3 w-px bg-line" /> : null}
              <ul className="flex min-w-0 flex-wrap items-stretch gap-0.5" aria-label={t(`groups.${g}`)}>
                {groupItems.map(({ key, href, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <li key={key} className="flex">
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors',
                          focusRing,
                          active
                            ? 'border-primary font-semibold text-primary'
                            : 'border-transparent text-muted hover:border-line hover:text-ink',
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {t(`links.${key}`)}
                        <NavBadge itemKey={key} wave1={wave1} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Mobile (< lg) navigation: a menu button that opens a full-height drawer
 * (search, every link by group, language, sign-out) plus a thumb-reachable
 * bottom bar with the role's first four destinations and "More".
 */
export function MobileNav({
  role,
  features,
  logout,
  restaurantName,
  email,
  showChain = false,
  branchSwitcher,
  wave1,
  receiverLangsOn = false,
}: {
  role: UserRole;
  features?: readonly string[];
  /** receiverLanguages flag: the drawer offers the same six-language picker as the header. */
  receiverLangsOn?: boolean;
  logout: () => Promise<void>;
  restaurantName: string;
  email: string;
  showChain?: boolean;
  /** The branch switcher (list variant), for users with more than one membership. */
  branchSwitcher?: React.ReactNode;
  wave1?: Wave1Nav;
}) {
  const t = useT(nav);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The drawer + bottom bar are portaled to <body>: the sticky header uses
  // backdrop-filter, which makes it the containing block for position:fixed
  // descendants (the bottom bar rendered at the TOP of the screen).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = visibleItems(role, showChain, features, wave1);
  // Bottom bar = the role's first four visible destinations. Only the AI
  // assistant (S14) stays drawer-only; other flag-gated items (recovery,
  // monthly report, recipes, inbox, contracts) keep their slot as on their
  // branches, e.g. a chef's bar is [overview, recipes, settings]. Leaks — the
  // hero ₪ page — is pinned for every role that sees it: the invoice inbox
  // (ingest flags) must not push it into the drawer.
  const barCandidates = items.filter((i) => i.key !== 'ask');
  const leaksItem = barCandidates.find((i) => i.key === 'leaks');
  let primary = barCandidates.slice(0, 4);
  if (leaksItem && !primary.includes(leaksItem)) primary = [...primary.slice(0, 3), leaksItem];

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes; lock page scroll while open; move focus in and back out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('menu.open')}
        aria-expanded={open}
        aria-controls="dashboard-drawer"
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink lg:hidden',
          focusRing,
        )}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {mounted && open
        ? createPortal(
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            id="dashboard-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('mainLabel')}
            className="absolute inset-y-0 start-0 flex w-[86%] max-w-sm flex-col border-e border-line bg-surface shadow-card"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">
                  <span {...originalProps(restaurantName)}>{restaurantName}</span>
                </p>
                <p className="truncate font-mono text-xs text-subtle">{email}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('menu.close')}
                className={cn('rounded-lg p-1.5 text-muted hover:text-ink', focusRing)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="border-b border-line px-4 py-3">
              <DashboardSearch role={role} />
            </div>
            {branchSwitcher ? <div className="border-b border-line px-2 py-3">{branchSwitcher}</div> : null}
            <nav aria-label={t('mainLabel')} className="flex-1 overflow-y-auto px-2 py-3">
              {GROUPS.map((g) => {
                const groupItems = items.filter((i) => i.group === g);
                if (groupItems.length === 0) return null;
                return (
                  <div key={g} className="mb-3">
                    <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
                      {t(`groups.${g}`)}
                    </p>
                    <ul>
                      {groupItems.map(({ key, href, icon: Icon }) => {
                        const active = isActive(pathname, href);
                        return (
                          <li key={key}>
                            <Link
                              href={href}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                                focusRing,
                                active
                                  ? 'bg-primary/12 font-semibold text-primary'
                                  : 'text-muted hover:bg-surface-2 hover:text-ink',
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              {t(`links.${key}`)}
                              <NavBadge itemKey={key} wave1={wave1} />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              {receiverLangsOn ? <LanguagePicker persist /> : <LocaleSwitcher />}
              <form action={logout} data-rm-logout="">
                <button
                  type="submit"
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink',
                    focusRing,
                  )}
                >
                  <LogOut className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
                  {t('signOut')}
                </button>
              </form>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}

      {/* Bottom bar — the four most-used destinations for this role + "More". */}
      {mounted ? createPortal(
      <nav
        aria-label={t('mobileLabel')}
        // Lifted above the cookie banner while it is shown (ConsentClearance).
        className="glass fixed inset-x-0 bottom-[var(--consent-h,0px)] z-40 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {primary.map(({ key, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={key} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] leading-tight',
                    focusRing,
                    active ? 'font-semibold text-primary' : 'text-muted hover:text-ink',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="max-w-full truncate">{t(`links.${key}`)}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="dashboard-drawer"
              className={cn(
                'flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[11px] leading-tight text-muted hover:text-ink',
                focusRing,
              )}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              {t('menu.more')}
            </button>
          </li>
        </ul>
      </nav>,
        document.body,
      ) : null}
    </>
  );
}
