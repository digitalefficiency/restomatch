'use client';

import { useEffect, useState } from 'react';
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
export function CookieConsent({ initialVisible = false }: { initialVisible?: boolean }) {
  const t = useT(marketing);
  // The root layout reads the consent cookie on the server and passes
  // `initialVisible`, so the banner is in the first HTML. Mounting it only
  // after hydration made its paragraph the LCP element (~2.2 s on a throttled
  // phone) on every page. The effect still covers a choice made in another tab.
  const [visible, setVisible] = useState(initialVisible);

  useEffect(() => {
    setVisible(getConsentChoice() === null);
  }, []);

  function choose(choice: ConsentChoice) {
    setConsentChoice(choice);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('cookie.label')}
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="glass mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border border-line bg-surface/95 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Cookie className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            {t('cookie.body')}{' '}
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
            className="rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {t('cookie.necessary')}
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-glow-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('cookie.all')}
          </button>
        </div>
      </div>
    </div>
  );
}
