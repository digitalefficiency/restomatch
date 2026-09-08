'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie } from 'lucide-react';
import { getConsentChoice, setConsentChoice, type ConsentChoice } from '@/lib/cookieConsent';

/**
 * Cookie-consent banner (E.3). Appears on first visit until the visitor makes a
 * choice; the choice is stored in a first-party cookie and the banner does not
 * reappear after reload. Strictly-necessary cookies (Auth.js session/CSRF) are
 * always active and are disclosed in the cookie policy; analytics stay off until
 * &quot;קבלת הכל&quot;.
 */
export function CookieConsent() {
  // Start hidden; decide after mount so SSR/CSR markup matches and we can read
  // the existing cookie.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getConsentChoice() === null) setVisible(true);
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
      aria-label="הסכמה לשימוש בעוגיות"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="glass mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl border border-line bg-surface/95 p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Cookie className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-muted">
            אנו משתמשים בעוגיות חיוניות לתפעול המאובטח של המערכת. עוגיות לא-חיוניות
            (כגון אנליטיקה) יופעלו רק לאחר אישורכם.{' '}
            <Link href="/cookies" className="text-primary underline hover:no-underline">
              למדיניות העוגיות
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose('necessary')}
            className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-primary/40"
          >
            רק חיוניות
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-glow-primary transition-opacity hover:opacity-90"
          >
            קבלת הכל
          </button>
        </div>
      </div>
    </div>
  );
}
