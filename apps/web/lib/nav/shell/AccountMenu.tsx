'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Keyboard, Languages, LogOut, Settings, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import { trpc } from '@/lib/trpc/client';
import { APP_LOCALES, LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SEC, LOCALE_NATIVE_NAMES, dirOf, type AppLocale } from '@/lib/i18n/config';
import { useAppLocale, useT } from '@/lib/i18n/client';
import { nav } from '@/lib/i18n/messages/nav';
import { navShell } from '@/lib/i18n/messages/nav/shell';
import { originalProps } from '@/lib/i18n/original';
import { useShellUi } from './ShellFrame';
import css from './shell.module.css';

export interface AccountMenuProps {
  userName: string;
  email: string;
  roleLabel: string;
  isPlatformAdmin: boolean;
  /** The six receiver languages are on for this restaurant (else עברית / English). */
  receiverLangs: boolean;
  logout: () => Promise<void>;
}

const itemClass = cn(
  'flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-start text-sm leading-5 text-ink outline-none',
  'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
);

/**
 * The account button and its menu in the side menu's user row (sidebar spec
 * §1.1, §1.6): `role="menu"` the width of the row, opening upward. Name · role ·
 * e-mail → personal settings · keyboard shortcuts (?) · the single-key switch →
 * language (first for the receiver) → the platform console → sign out.
 * ↑↓ Home End move, Esc closes and returns to the button, Tab closes and
 * continues from the button (§8 popover contract).
 */
export function AccountMenu({ userName, email, roleLabel, isPlatformAdmin, receiverLangs, logout }: AccountMenuProps) {
  const t = useT(nav);
  const ts = useT(navShell);
  const ui = useShellUi();
  const locale = useAppLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ start: number; bottom: number } | null>(null);
  const [, startTransition] = useTransition();
  const save = trpc.receiverLangs.setMyLocale.useMutation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = 'rm-account-panel';
  const initial = (userName.trim().charAt(0) || email.trim().charAt(0) || '?').toUpperCase();
  const languages: readonly AppLocale[] = receiverLangs ? APP_LOCALES : LOCALES;

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  // Place the menu: above the user row in the panel; beside the rail, bottom-aligned, when collapsed.
  useLayoutEffect(() => {
    if (!open) return;
    const b = buttonRef.current;
    const aside = b?.closest('aside');
    if (!b || !aside) return;
    const a = aside.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const row = b.parentElement?.getBoundingClientRect() ?? r;
    const vh = window.innerHeight;
    const wide = a.width > 120;
    setPos(wide ? { start: 12, bottom: vh - row.top + 4 } : { start: Math.round(a.width) + 8, bottom: Math.max(8, vh - r.bottom) });
  }, [open, ui.mode]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Close, and let Tab continue from the button.
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  function switchTo(target: AppLocale) {
    close();
    if (target === locale) return;
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
    document.documentElement.lang = target;
    document.documentElement.dir = dirOf(target);
    const refresh = () => startTransition(() => router.refresh());
    if (receiverLangs) save.mutateAsync({ locale: target }).then(refresh, refresh);
    else refresh();
  }

  const languageItems = (
    <div role="group" aria-label={t('shell.language')} className="py-1">
      <p aria-hidden="true" className="flex items-center gap-2 px-2 pb-1 pt-1.5 text-xs font-semibold leading-4 text-subtle">
        <Languages aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
        {t('shell.language')}
      </p>
      {languages.map((l) => (
        <button
          key={l}
          type="button"
          role="menuitemradio"
          aria-checked={l === locale}
          lang={l}
          dir={dirOf(l)}
          tabIndex={-1}
          onClick={() => switchTo(l)}
          className={itemClass}
        >
          <span className="min-w-0 flex-1 text-start">{LOCALE_NATIVE_NAMES[l]}</span>
          {l === locale ? <Check aria-hidden="true" width={16} height={16} className="text-primary" /> : null}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={css.acc}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="avatar-menu"
        data-tip={userName || email}
        data-tip-text={roleLabel}
        data-tip-when="rail"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true" className={cn(css.ava, 'text-xs font-semibold leading-4 text-ink')}>
          {initial}
        </span>
        <span className={css.accText}>
          <span className="truncate text-sm font-semibold leading-[18px] text-ink">
            <span {...originalProps(userName || email)}>{userName || email}</span>
          </span>
          <span className="truncate text-xs leading-4 text-subtle">{roleLabel}</span>
        </span>
        <span className="sr-only">, {t('menu.account')}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('menu.account')}
          onKeyDown={onMenuKey}
          data-testid="account-menu"
          style={{ insetInlineStart: pos?.start ?? 12, bottom: pos?.bottom ?? 64, visibility: pos ? 'visible' : 'hidden' }}
          className="fixed z-sheet w-[223px] rounded-card bg-surface p-1 text-ink shadow-e2 ring-1 ring-line"
        >
          <div className="border-b border-line px-2 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold leading-5 text-ink">
              <span {...originalProps(userName || email)}>{userName || email}</span>
            </p>
            <p className="truncate text-xs leading-4 text-subtle">{roleLabel}</p>
            <p className="truncate text-xs leading-4 text-subtle">
              <bdi>{email}</bdi>
            </p>
          </div>
          {ui.role === 'receiver' ? languageItems : null}
          <div role="group" className="py-1">
            <Link href="/dashboard/settings" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>
              <Settings aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="text-muted" />
              {ts('account.settings')}
            </Link>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              onClick={() => {
                close(false);
                ui.openCheat();
              }}
            >
              <Keyboard aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="text-muted" />
              <span className="min-w-0 flex-1">{ts('account.shortcuts')}</span>
              <kbd dir="ltr" aria-hidden="true" className="inline-flex h-5 items-center rounded-xs bg-surface-2 px-1.5 font-sans text-xs font-medium leading-4 text-muted">
                ?
              </kbd>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={ui.singleKeys}
              tabIndex={-1}
              className={itemClass}
              onClick={() => ui.setSingleKeys(!ui.singleKeys)}
            >
              <span className="min-w-0 flex-1">{ts('account.singleKeys')}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors duration-micro',
                  ui.singleKeys ? 'bg-primary' : 'bg-line-strong',
                )}
              >
                <span
                  className={cn(
                    'absolute h-4 w-4 rounded-pill bg-surface shadow-e1 transition-[inset-inline-start] duration-micro',
                    ui.singleKeys ? 'start-[18px]' : 'start-0.5',
                  )}
                />
              </span>
            </button>
          </div>
          {ui.role !== 'receiver' ? <div className="border-t border-line">{languageItems}</div> : null}
          <div role="group" className="border-t border-line py-1">
            {isPlatformAdmin ? (
              <Link href="/admin" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>
                <ShieldCheck aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="text-muted" />
                {t('shell.platformAdmin')}
              </Link>
            ) : null}
            <form action={logout} data-rm-logout="">
              <button type="submit" role="menuitem" tabIndex={-1} className={itemClass}>
                <LogOut aria-hidden="true" width={16} height={16} strokeWidth={1.75} className="text-muted rtl:-scale-x-100" />
                {t('signOut')}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
