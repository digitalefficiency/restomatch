'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { getConsentChoice, setConsentChoice, type ConsentChoice } from '@/lib/cookieConsent';
import { useT } from '@/lib/i18n/client';
import { marketing } from '@/lib/i18n/messages/marketing';

/**
 * Cookie-consent banner (E.3). Appears on first visit until the visitor makes a
 * choice; the choice is stored in a first-party cookie and the banner does not
 * reappear after reload. Strictly-necessary cookies (Auth.js session/CSRF) are
 * always active and are disclosed in the cookie policy; analytics stay off until
 * "accept all".
 */
export function CookieConsent() {
  const t = useT(marketing);
  // Start hidden; decide after mount so SSR/CSR markup matches and we can read
  // the existing cookie.
  const [visible, setVisible] = useState(false);
  // Measured before it's shown: if it would cover the page's primary CTA
  // ([data-keep-clear], e.g. the landing hero button on a small phone), it waits
  // until the visitor scrolls that CTA clear. Non-essential cookies stay off
  // until a choice is made, so showing it a moment later changes nothing.
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (getConsentChoice() === null) setVisible(true);
  }, []);

  // While shown, reserve the banner's height at the bottom of the page so it
  // never sits on top of content for good (e.g. the landing's primary CTA on a
  // phone): everything can scroll clear of it.
  useEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const clear = () => {
      const keep = document.querySelector('[data-keep-clear]');
      return !keep || keep.getBoundingClientRect().bottom <= window.innerHeight - el.offsetHeight;
    };
    if (clear()) {
      setShown(true);
      return;
    }
    const onScroll = () => {
      if (!clear()) return;
      setShown(true);
      window.removeEventListener('scroll', onScroll);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [visible]);

  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const body = document.body;
    const prev = body.style.paddingBottom;
    const ro = new ResizeObserver(() => {
      body.style.paddingBottom = `${el.offsetHeight}px`;
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      body.style.paddingBottom = prev;
    };
  }, [shown]);

  function choose(choice: ConsentChoice) {
    setConsentChoice(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-live="polite"
      aria-label={t('cookie.label')}
      className={`fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4 ${shown ? '' : 'invisible'}`}
      aria-hidden={!shown || undefined}
    >
      {/* Compact on phones (it must not cover the primary CTA); roomier from sm up. */}
      <div className="glass mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-card sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary sm:flex">
            <Cookie className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-muted sm:text-sm">
            <span className="sm:hidden">{t('cookie.short')}</span>
            <span className="hidden sm:inline">{t('cookie.body')}</span>{' '}
            <Link href="/cookies" className="text-primary underline hover:no-underline">
              {t('cookie.link')}
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose('necessary')}
            className="flex-1 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm sm:flex-none sm:py-2.5 font-medium text-ink transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {t('cookie.necessary')}
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm sm:flex-none sm:py-2.5 font-semibold text-on-primary shadow-glow-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('cookie.all')}
          </button>
        </div>
      </div>
    </div>
  );
}
