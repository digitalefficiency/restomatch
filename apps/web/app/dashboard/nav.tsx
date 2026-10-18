'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  FileDown,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  PackageCheck,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { cn } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { nav } from '@/lib/i18n/messages/nav';
import { canSeeRoute } from '@/lib/roles';
import { DashboardSearch } from './search';

type LinkKey =
  | 'overview'
  | 'receiving'
  | 'approvals'
  | 'leaks'
  | 'suppliers'
  | 'catalog'
  | 'orders'
  | 'exports'
  | 'team'
  | 'settings';
type GroupKey = 'operations' | 'purchasing' | 'admin';

interface NavItem {
  key: LinkKey;
  href: string;
  icon: LucideIcon;
  group: GroupKey;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', href: '/dashboard', icon: LayoutDashboard, group: 'operations' },
  { key: 'receiving', href: '/dashboard/receiving', icon: PackageCheck, group: 'operations' },
  { key: 'approvals', href: '/dashboard/approvals', icon: Inbox, group: 'operations' },
  { key: 'leaks', href: '/dashboard/leaks', icon: BarChart3, group: 'operations' },
  { key: 'suppliers', href: '/dashboard/suppliers', icon: Truck, group: 'purchasing' },
  { key: 'catalog', href: '/dashboard/catalog', icon: Boxes, group: 'purchasing' },
  { key: 'orders', href: '/dashboard/orders', icon: ShoppingCart, group: 'purchasing' },
  { key: 'exports', href: '/dashboard/exports', icon: FileDown, group: 'admin' },
  { key: 'team', href: '/dashboard/team', icon: Users, group: 'admin' },
  { key: 'settings', href: '/dashboard/settings', icon: Settings, group: 'admin' },
];

const GROUPS: GroupKey[] = ['operations', 'purchasing', 'admin'];

/** Products live under the catalog; treat their detail pages as "catalog" in the nav. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  if (href === '/dashboard/catalog' && pathname.startsWith('/dashboard/products')) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function visibleItems(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter(({ href }) => canSeeRoute(role, href));
}

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Desktop (lg+) primary nav: one calm row of tabs under the top bar, grouped
 * with hairline separators. Scrolls horizontally instead of wrapping if a
 * narrow laptop can't fit every tab.
 */
export function DesktopNav({ role }: { role: UserRole }) {
  const t = useT(nav);
  const pathname = usePathname();
  const items = visibleItems(role);
  return (
    <nav aria-label={t('mainLabel')} className="hidden lg:block">
      <ul className="-mb-px flex items-stretch gap-1 overflow-x-auto text-sm [scrollbar-width:none]">
        {GROUPS.map((g, gi) => {
          const groupItems = items.filter((i) => i.group === g);
          if (groupItems.length === 0) return null;
          return (
            <li key={g} className="flex items-stretch gap-1">
              {gi > 0 ? <span aria-hidden="true" className="my-3 w-px bg-line" /> : null}
              <ul className="flex items-stretch gap-0.5" aria-label={t(`groups.${g}`)}>
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
  logout,
  restaurantName,
  email,
}: {
  role: UserRole;
  logout: () => Promise<void>;
  restaurantName: string;
  email: string;
}) {
  const t = useT(nav);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const items = visibleItems(role);
  const primary = items.slice(0, 4);

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

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
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
                <p className="truncate text-base font-bold text-ink">{restaurantName}</p>
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
              <LocaleSwitcher />
              <form action={logout}>
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
        </div>
      ) : null}

      {/* Bottom bar — the four most-used destinations for this role + "More". */}
      <nav
        aria-label={t('mobileLabel')}
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden"
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
      </nav>
    </>
  );
}
