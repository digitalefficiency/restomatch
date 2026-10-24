'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Network, Settings2, Store } from 'lucide-react';
import type { UserRole } from '@restomatch/db';
import { cn, Spinner, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { chain } from '@/lib/i18n/messages/chain';
import { labelForRole } from '@/lib/roles';
import { switchBranchAction } from './branch-actions';

export interface SwitcherBranch {
  restaurantId: string;
  restaurantName: string;
  role: UserRole;
}

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Branch switcher for users with more than one membership. Lists every
 * membership (any role); picking one calls the switch server action, which
 * re-validates the membership before refreshing the session.
 */
export function BranchSwitcher({
  branches,
  activeId,
  className,
  variant = 'popover',
}: {
  branches: SwitcherBranch[];
  activeId: string;
  className?: string;
  /** 'popover' = header dropdown (desktop); 'list' = inline list (mobile drawer). */
  variant?: 'popover' | 'list';
}) {
  const t = useT(chain);
  const locale = useLocale();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
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
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (branches.length < 2 || !active) return null;

  function pick(id: string, then = '/dashboard') {
    if (id === activeId || isPending) {
      setOpen(false);
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      const res = await switchBranchAction(id).catch(() => ({ ok: false as const }));
      if (res.ok) {
        window.location.assign(then);
        return;
      }
      toast.error(t('switcher.failed'));
      setPendingId(null);
    });
  }

  const list = (
    <ul role={variant === 'popover' ? 'menu' : undefined} className="py-1" id={menuId}>
      {branches.map((b) => {
        const isActive = b.restaurantId === activeId;
        return (
          <li key={b.restaurantId} role={variant === 'popover' ? 'none' : undefined}>
            <button
              type="button"
              role={variant === 'popover' ? 'menuitemradio' : undefined}
              aria-checked={variant === 'popover' ? isActive : undefined}
              aria-current={variant === 'list' && isActive ? 'true' : undefined}
              disabled={isPending}
              onClick={() => pick(b.restaurantId)}
              data-testid="branch-option"
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors',
                focusRing,
                isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-surface-2',
              )}
            >
              <Store className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  <span {...originalProps(b.restaurantName)}>{b.restaurantName}</span>
                </span>
                <span className="block text-xs text-subtle">{labelForRole(b.role, locale)}</span>
              </span>
              {pendingId === b.restaurantId ? (
                <Spinner className="h-4 w-4" />
              ) : isActive ? (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
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
        data-testid="branch-footer-link"
        data-href={href}
        className={cn('inline-flex items-center gap-1', focusRing, className)}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
    ) : (
      <Link href={href} data-testid="branch-footer-link" data-href={href} className={cn('inline-flex items-center gap-1', className)} onClick={() => setOpen(false)}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Link>
    );

  const footer = showFooter ? (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs">
      {footerLink('/dashboard/chain', 'font-semibold text-primary hover:text-ink', Network, t('switcher.chainLink'))}
      {footerLink('/dashboard/branches', 'text-muted hover:text-ink', Settings2, t('switcher.manageLink'))}
      {ownedTarget ? (
        <span className="w-full text-subtle">
          {t('switcher.viaOwned')} <span {...originalProps(ownedTarget.restaurantName)}>{ownedTarget.restaurantName}</span>
        </span>
      ) : null}
    </div>
  ) : null;

  if (variant === 'list') {
    return (
      <div className={className} data-testid="branch-switcher-list">
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-subtle">{t('switcher.title')}</p>
        {list}
        {footer}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('switcher.label')}
        data-testid="branch-switcher"
        className={cn(
          'inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-primary/40',
          focusRing,
        )}
      >
        {isPending ? <Spinner className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
        <span className="truncate">
          <span {...originalProps(active.restaurantName)}>{active.restaurantName}</span>
        </span>
        <span className="rounded-md bg-primary/12 px-1.5 text-[10px] tabular-nums text-primary">{branches.length}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute start-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-surface p-1 shadow-card">
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-subtle">{t('switcher.title')}</p>
          {list}
          {footer}
        </div>
      ) : null}
    </div>
  );
}
