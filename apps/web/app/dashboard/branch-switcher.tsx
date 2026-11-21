'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronDown, ChevronsUpDown, Network, Settings2, Store } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { cn, Spinner, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { chain } from '@/lib/i18n/messages/chain';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import shellCss from '@/lib/nav/shell/shell.module.css';
import { common } from '@/lib/i18n/messages/common';
import { screenKeyForPath } from '@/lib/net/access';
import { branchSafeTarget, type BranchTarget } from '@/lib/net/branchSafeTarget';
import { saveSwitchNotice, takeSwitchNotice } from '@/lib/net/switchNotice';
import { labelForRole } from '@/lib/roles';
import { switchBranchAction } from './branch-actions';

export interface SwitcherBranch {
  restaurantId: string;
  restaurantName: string;
  role: UserRole;
}

const focusRing =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus';

/**
 * Branch switcher for users with more than one membership. Lists every
 * membership (any role); picking one calls the switch server action, which
 * re-validates the membership before refreshing the session.
 *
 * The switch keeps the user's place (W1-04, ia-nav-08 / exec-desktop-23): a
 * list keeps its path and non-entity filters, a detail page falls back to its
 * parent list, a screen the target role can't open falls back to home — the
 * last two with a toast that says why (lib/net/branchSafeTarget.ts).
 */
export function BranchSwitcher({
  branches,
  activeId,
  className,
  variant = 'popover',
  subline,
}: {
  branches: SwitcherBranch[];
  activeId: string;
  className?: string;
  /**
   * 'head' = the side menu's head (desktop, DS3-02: monogram · name · "role · N branches" ·
   * ChevronsUpDown; a 320 px menu below it, beside the rail when collapsed);
   * 'popover' = the phone top bar chip; 'list' = inline list (the "עוד" sheet).
   */
  variant?: 'head' | 'popover' | 'list';
  /** 'head': the line under the name ("בעלים · 3 סניפים"). */
  subline?: string;
}) {
  const ts = useT(navShell);
  const tn = useT(nav);
  const t = useT(chain);
  const tc = useT(common);
  const locale = useLocale();
  const toast = useToast();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; start: number } | null>(null);
  // Fixed per variant, not useId() (see DashboardSearch): one popover and one
  // drawer list per page.
  const menuId = `branch-switcher-${variant}-menu`;
  const active = branches.find((b) => b.restaurantId === activeId) ?? branches[0];
  // /dashboard/chain and /dashboard/branches are gated on the ACTIVE role
  // (middleware). Owner here → plain links; owner only in another branch →
  // the same links switch to that branch first (else they would bounce back).
  const ownedTarget = active?.role === 'owner' ? null : (branches.find((b) => b.role === 'owner') ?? null);
  const showFooter = active?.role === 'owner' || ownedTarget !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // After the full navigation of a switch: say why we did not land on the same page.
  useEffect(() => {
    if (variant !== 'popover') return;
    const notice = takeSwitchNotice();
    if (!notice) return;
    const screen = tc(`shell.screens.${notice.screen}`);
    toast.success(
      notice.reason === 'parent'
        ? tc('shell.branch.openedParent', { branch: notice.branch, screen })
        : tc('shell.branch.openedHome', { branch: notice.branch, screen }),
    );
    // Once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open: focus the current branch; the head's menu sits below the head, or beside the rail (§1.6).
  useLayoutEffect(() => {
    if (!open || variant !== 'head') return;
    const b = triggerRef.current;
    const aside = b?.closest('aside');
    if (!b || !aside) return;
    const a = aside.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    setPlace(a.width > 120 ? { top: Math.round(a.top + 56 + 4), start: 12 } : { top: Math.round(r.top), start: Math.round(a.width) + 8 });
  }, [open, variant]);
  useEffect(() => {
    if (!open || variant === 'list') return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [open, variant]);

  if (branches.length < 2 || !active) return null;

  /** Menu keys (§8 popovers): ↑↓ Home End move; Tab closes and continues from the trigger. */
  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], a[href], button[data-testid="branch-footer-link"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  /**
   * Tab / Shift+Tab out of the switcher closes it (§8 popover contract), also when focus leaves from the
   * trigger before the menu has taken it, and when a click lands elsewhere.
   */
  function onLeave(e: React.FocusEvent<HTMLDivElement>) {
    if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  /** Same page in the target branch, minus what belongs to the branch being left. */
  function placeIn(target: SwitcherBranch): BranchTarget {
    return branchSafeTarget(pathname ?? '/dashboard', window.location.search, target.role);
  }

  function pick(id: string, then?: string) {
    if (id === activeId || isPending) {
      setOpen(false);
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      const res = await switchBranchAction(id).catch(() => ({ ok: false as const }));
      if (res.ok) {
        const target = branches.find((b) => b.restaurantId === id);
        let href = then ?? '/dashboard';
        if (!then && target) {
          const place = placeIn(target);
          href = place.href;
          if (place.reason !== 'kept') {
            saveSwitchNotice({
              branch: target.restaurantName,
              reason: place.reason,
              screen: screenKeyForPath(place.reason === 'parent' ? place.href : place.fromPath),
            });
          }
        }
        window.location.assign(href);
        return;
      }
      toast.error(t('switcher.failed'));
      setPendingId(null);
    });
  }

  const list = (
    <ul role={variant === 'list' ? undefined : 'none'} className="py-1" id={variant === 'list' ? menuId : undefined}>
      {branches.map((b) => {
        const isActive = b.restaurantId === activeId;
        return (
          <li key={b.restaurantId} role={variant === 'list' ? undefined : 'none'}>
            <button
              type="button"
              role={variant === 'list' ? undefined : 'menuitemradio'}
              aria-checked={variant === 'list' ? undefined : isActive}
              tabIndex={variant === 'list' ? undefined : -1}
              aria-current={variant === 'list' && isActive ? 'true' : undefined}
              disabled={isPending}
              onClick={() => pick(b.restaurantId)}
              data-testid="branch-option"
              className={cn(
                'flex w-full items-center gap-3 rounded-control px-3 text-start text-sm leading-5 transition-colors',
                variant === 'head' ? 'min-h-[52px]' : 'py-2',
                focusRing,
                isActive ? 'bg-primary-subtle text-ink' : 'text-ink hover:bg-surface-2',
              )}
            >
              <Store className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate', variant === 'head' ? 'font-medium' : 'font-semibold')}>
                  <span {...originalProps(b.restaurantName)}>{b.restaurantName}</span>
                </span>
                <span className="block text-xs text-subtle">{labelForRole(b.role, locale)}</span>
              </span>
              {pendingId === b.restaurantId ? (
                <Spinner className="h-4 w-4" />
              ) : isActive ? (
                <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );

  const footerLink = (href: string, className: string, Icon: typeof Network, label: string) =>
    ownedTarget ? (
      <button
        type="button"
        disabled={isPending}
        onClick={() => pick(ownedTarget.restaurantId, href)}
        title={`${t('switcher.viaOwned')} ${ownedTarget.restaurantName}`}
        role={variant === 'list' ? undefined : 'menuitem'}
        tabIndex={variant === 'list' ? undefined : -1}
        data-testid="branch-footer-link"
        data-href={href}
        className={cn('touch-target inline-flex items-center gap-1', focusRing, className)}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
    ) : (
      <Link
        href={href}
        role={variant === 'list' ? undefined : 'menuitem'}
        tabIndex={variant === 'list' ? undefined : -1}
        data-testid="branch-footer-link"
        data-href={href} className={cn('touch-target inline-flex items-center gap-1', className)} onClick={() => setOpen(false)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Link>
    );

  const footer = showFooter ? (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs">
      {/* The menu's own name for the page (sidebar spec §1.6 footer: סקירת רשת). */}
      {footerLink('/dashboard/chain', 'font-semibold text-primary hover:text-ink', Network, tn('links.chain'))}
      {footerLink('/dashboard/branches', 'text-muted hover:text-ink', Settings2, t('switcher.manageLink'))}
      {ownedTarget ? (
        <span className="w-full text-subtle">
          {t('switcher.viaOwned')} <span {...originalProps(ownedTarget.restaurantName)}>{ownedTarget.restaurantName}</span>
        </span>
      ) : null}
    </div>
  ) : null;

  if (variant === 'head') {
    return (
      <div ref={rootRef} className={cn('min-w-0 flex-1', className)} onBlur={onLeave}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
            }
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          data-testid="branch-switcher"
          className={cn(shellCss.headBtn, 'w-full')}
        >
          <span aria-hidden="true" className={cn(shellCss.mono, 'text-xs font-bold leading-4')}>
            {isPending ? <Spinner className="h-3.5 w-3.5" /> : active.restaurantName.trim().charAt(0) || 'R'}
          </span>
          <span className={shellCss.headText}>
            <span className="truncate text-sm font-semibold leading-[18px] text-ink">
              <span {...originalProps(active.restaurantName)}>{active.restaurantName}</span>
            </span>
            {subline ? <span className="truncate text-xs leading-4 text-subtle">{subline}</span> : null}
          </span>
          <ChevronsUpDown aria-hidden="true" width={16} height={16} strokeWidth={1.75} className={shellCss.headChev} />
          <span className="sr-only"> — {t('switcher.label')}</span>
        </button>
        {open ? (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t('switcher.label')}
            onKeyDown={onMenuKey}
            style={{ top: place?.top ?? 60, insetInlineStart: place?.start ?? 12, visibility: place ? 'visible' : 'hidden' }}
            className="fixed z-sheet w-[320px] max-w-[calc(100vw-1rem)] rounded-card bg-surface p-1 text-ink shadow-e2 ring-1 ring-line"
          >
            <p aria-hidden="true" className="px-3 pb-1 pt-2 text-xs font-semibold leading-4 text-subtle">
              {ts('switcher.title')}
            </p>
            {list}
            {footer}
          </div>
        ) : null}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className={className} data-testid="branch-switcher-list">
        <p className="px-3 pb-1 text-xs font-semibold leading-4 text-subtle">{t('switcher.title')}</p>
        {list}
        {footer}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative', className)} onBlur={onLeave}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="branch-switcher-phone"
        className={cn(
          'inline-flex min-h-11 max-w-[16rem] items-center gap-1.5 rounded-control border border-line bg-surface-2 px-2.5 text-xs font-semibold text-ink transition-colors hover:border-line-strong',
          focusRing,
        )}
      >
        {isPending ? <Spinner className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
        <span className="truncate">
          <span {...originalProps(active.restaurantName)}>{active.restaurantName}</span>
        </span>
        <span className="rounded-xs bg-primary-subtle px-1.5 text-xs tabular-nums text-primary">{branches.length}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
        {/* The name comes from the content (visible branch + count), then the action — an
            aria-label would hide the visible text (axe label-content-name-mismatch). */}
        <span className="sr-only"> — {t('switcher.label')}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('switcher.label')}
          onKeyDown={onMenuKey}
          className="absolute start-0 top-full z-sheet mt-2 w-72 rounded-card border border-line bg-surface p-1 shadow-e2"
        >
          <p aria-hidden="true" className="px-3 pb-1 pt-2 text-xs font-semibold leading-4 text-subtle">{t('switcher.title')}</p>
          {list}
          {footer}
        </div>
      ) : null}
    </div>
  );
}
