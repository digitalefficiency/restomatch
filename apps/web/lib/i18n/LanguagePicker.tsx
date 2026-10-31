'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { cn } from '@/lib/components/cn';
import {
  APP_LOCALES,
  dirOf,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SEC,
  LOCALE_NATIVE_NAMES,
  type AppLocale,
} from './config';
import { useAppLocale, useT } from './client';
import { receiverLangs } from './messages/receiverLangs';

/**
 * Six-language picker (he · en · ar · ru · th · ti) as a button + menu: arrow
 * keys move inside the open menu and only Enter / click switches the language
 * (a native <select> switched on ↓, a11y-14). Replaces the עב/EN toggle
 * where the `receiverLanguages` flag is on (dashboard) or on signed-out pages
 * (login), unless killed by FEATURES_OFF. Writes `rm_locale`, flips <html
 * lang/dir> at once and refreshes server components. No tRPC here: the login
 * page has no TrpcProvider. The dashboard uses `PersistingLanguagePicker`
 * (./PersistingLanguagePicker), which passes `onSave` to also store the choice
 * as the member's language (best effort), so the next login on a new phone opens in it.
 */
export function LanguagePicker({
  className,
  onSave,
}: {
  className?: string;
  onSave?: (locale: AppLocale) => Promise<unknown>;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const t = useT(receiverLangs);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Fixed id, not useId() (see DashboardSearch): one picker per page region.
  const menuId = `language-picker-menu-${useStableSuffix(className)}`;

  function switchTo(target: AppLocale) {
    setOpen(false);
    buttonRef.current?.focus();
    if (target === locale) return;
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
    document.documentElement.lang = target;
    document.documentElement.dir = dirOf(target);
    const refresh = () => startTransition(() => router.refresh());
    if (onSave) onSave(target).then(refresh, refresh);
    else refresh();
  }

  useEffect(() => {
    if (!open) return;
    // Focus the current language when the menu opens.
    const idx = Math.max(0, APP_LOCALES.indexOf(locale));
    itemRefs.current[idx]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, locale]);

  // Arrow keys only MOVE focus inside the open menu; nothing changes until Enter / click (WCAG 3.2.2).
  function onMenuKey(e: React.KeyboardEvent) {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
      if (e.key === 'Escape') buttonRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        title={t('picker.title')}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid="language-picker"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        <Languages className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        {/* Visible text first in the accessible name (WCAG 2.5.3). */}
        <span lang={locale}>{LOCALE_NATIVE_NAMES[locale]}</span>
        <span className="sr-only"> — {t('picker.label')}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
      </button>
      <ul
        id={menuId}
        role="menu"
        aria-label={t('picker.label')}
        hidden={!open}
        onKeyDown={onMenuKey}
        className="absolute end-0 top-full z-50 mt-2 min-w-40 rounded-xl border border-line bg-surface p-1 shadow-card"
      >
        {APP_LOCALES.map((l, i) => (
          <li key={l} role="none">
            <button
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              lang={l}
              tabIndex={-1}
              onClick={() => switchTo(l)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-sm text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            >
              {LOCALE_NATIVE_NAMES[l]}
              {l === locale ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A per-placement id suffix: the header and the "עוד" sheet each render one picker. */
function useStableSuffix(className?: string): string {
  return className ? className.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'x' : 'main';
}
