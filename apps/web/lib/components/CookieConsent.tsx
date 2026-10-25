'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Cookie } from 'lucide-react';
import { consentPlacement, getConsentChoice, setConsentChoice, type ConsentChoice } from '@/lib/cookieConsent';
import { useT } from '@/lib/i18n/client';
import { marketing } from '@/lib/i18n/messages/marketing';

/**
 * Cookie-consent banner (E.3; a11y-12). Shown until the visitor makes a choice;
 * the choice is a first-party cookie, so it does not reappear after reload.
 * Strictly-necessary cookies (Auth.js session/CSRF) are always active and are
 * disclosed in the cookie policy; analytics stay off until "accept all".
 *
 * - A labelled `region` (not a dialog, not a live region), rendered FIRST in
 *   <body> by the root layout, so it is the first stop in the focus order.
 * - Esc anywhere inside it = "רק חיוניות" (the safe, reversible default).
 * - Inside the app and on auth / portal routes it is an inline strip at the
 *   top of the page (never over a form, the bottom nav or a field CTA); on
 *   marketing pages a floating card that publishes its height as `--consent-h`
 *   and waits until the page's `[data-keep-clear]` CTA is clear.
 *
 * `decided` comes from the server (the consent cookie), so the inline strip
 * renders in the first paint and never shifts the layout.
 */
export function CookieConsent({ decided = false }: { decided?: boolean }) {
  const t = useT(marketing);
  const pathname = usePathname();
  const placement = consentPlacement(pathname);
  const [visible, setVisible] = useState(!decided);
  // Floating only: measured before it's shown — if it would cover the page's
  // primary CTA ([data-keep-clear]), it waits until that CTA is scrolled clear.
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(getConsentChoice() === null);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!visible || placement !== 'floating' || !el) return;
    const clear = () => {
      const keep = document.querySelector('[data-keep-clear]');
      return !keep || keep.getBoundingClientRect().bottom <= window.innerHeight - el.offsetHeight;
    };
    setShown(clear());
    const check = () => {
      if (clear()) setShown(true);
    };
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [visible, placement, pathname]);

  // Floating and shown: reserve its height at the bottom of the page and publish
  // it as --consent-h (bottom-anchored app UI and scroll-padding add it).
  useEffect(() => {
    const el = ref.current;
    if (!shown || placement !== 'floating' || !el) return;
    const root = document.documentElement;
    const body = document.body;
    const prev = body.style.paddingBottom;
    const ro = new ResizeObserver(() => {
      body.style.paddingBottom = `${el.offsetHeight}px`;
      root.style.setProperty('--consent-h', `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      body.style.paddingBottom = prev;
      root.style.setProperty('--consent-h', '0px');
    };
  }, [shown, placement]);

  function choose(choice: ConsentChoice) {
    setConsentChoice(choice);
    setShown(false);
    setVisible(false);
  }

  if (!visible) return null;

  const link = (
    <Link href="/cookies" className="whitespace-nowrap text-primary underline hover:no-underline">
      {t('cookie.link')}
    </Link>
  );
  const buttons = (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        onClick={() => choose('necessary')}
        className="min-h-10 flex-1 rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors duration-micro hover:bg-surface-2 sm:flex-none"
      >
        {t('cookie.necessary')}
      </button>
      <button
        type="button"
        onClick={() => choose('all')}
        className="min-h-10 flex-1 rounded-control bg-primary-bold px-4 text-sm font-semibold text-on-bold transition-colors duration-micro hover:bg-primary-bold-hover sm:flex-none"
      >
        {t('cookie.all')}
      </button>
    </div>
  );
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      choose('necessary');
    }
  };

  if (placement === 'inline') {
    // One compact row (mobile-field-19): it must not push a short auth card below the fold.
    return (
      <div
        ref={ref}
        role="region"
        aria-label={t('cookie.label')}
        data-consent="inline"
        onKeyDown={onKeyDown}
        className="border-b border-line bg-surface print:hidden"
      >
        <div className="mx-auto flex max-w-app items-center justify-between gap-3 px-4 py-1.5">
          <p className="min-w-0 text-xs leading-4 text-muted sm:text-sm sm:leading-5">
            {t('cookie.short')} {link}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => choose('necessary')}
              className="min-h-9 whitespace-nowrap rounded-control [@media(pointer:coarse)]:min-h-11 border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors duration-micro hover:bg-surface-2 sm:px-4 sm:text-sm"
            >
              {t('cookie.necessary')}
            </button>
            <button
              type="button"
              onClick={() => choose('all')}
              className="min-h-9 whitespace-nowrap rounded-control [@media(pointer:coarse)]:min-h-11 bg-primary-bold px-2.5 text-xs font-semibold text-on-bold transition-colors duration-micro hover:bg-primary-bold-hover sm:px-4 sm:text-sm"
            >
              {t('cookie.all')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t('cookie.label')}
      data-consent="floating"
      onKeyDown={onKeyDown}
      className={`fixed inset-x-0 bottom-0 z-consent px-3 pb-3 print:hidden sm:px-4 sm:pb-4 ${shown ? '' : 'invisible'}`}
      aria-hidden={!shown || undefined}
    >
      {/* Compact on phones (it must not cover the primary CTA); roomier from sm up. */}
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-overlay border border-line bg-surface p-3 shadow-e2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary-subtle text-primary sm:flex">
            <Cookie className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-muted sm:text-sm">
            <span className="sm:hidden">{t('cookie.short')}</span>
            <span className="hidden sm:inline">{t('cookie.body')}</span> {link}
          </p>
        </div>
        {buttons}
      </div>
    </div>
  );
}
