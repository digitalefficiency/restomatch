import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { featureEnabled } from '@restomatch/api';
import { cn } from '@/lib/components';
import { LanguagePicker } from '@/lib/i18n/LanguagePicker';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import type { MessageKey } from '@/lib/i18n/translate';

const WIDTH = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' } as const;

/**
 * The one frame of every signed-out surface — sign-in, check-email, 2FA, reset,
 * set-password, invite, onboarding and the supplier portal (auth-22, auth-30,
 * auth-32): a skip link, the brand back to the site, ONE language control, a
 * single <main> and the legal footer. Below `sm` the content runs full-bleed
 * (no card-in-card on a phone); from `sm` it sits in a centred card.
 *
 * `plain` drops the card chrome (the supplier portal lays out its own cards).
 * The bottom padding keeps the cookie bar (`--consent-h`) off the last control.
 */
export async function AuthShell({
  children,
  width = 'md',
  plain = false,
  headerExtra,
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
  plain?: boolean;
  /** Extra header control (e.g. sign-out on onboarding), placed before the language picker. */
  headerExtra?: React.ReactNode;
}) {
  const t = await getT(authMessages);
  // Receiver languages (S14): a receiver picks ar/ru/th/ti before signing in
  // (only the FEATURES_OFF kill-switch applies — no restaurant yet).
  const sixLanguages = featureEnabled({ features: { receiverLanguages: true } }, 'receiverLanguages');
  return (
    <div className="flex min-h-screen flex-col pb-[var(--consent-h,0px)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-ink shadow focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t('shell.skip')}
      </a>
      <header className={cn('mx-auto flex w-full items-center justify-between gap-3 px-4 pt-4 sm:px-6', WIDTH[width], 'sm:max-w-none')}>
        <Link
          href="/"
          aria-label={t('shell.home')}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg text-ink"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-on-primary">
            <Receipt className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-base font-bold" aria-hidden="true">
            RestoMatch
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {headerExtra}
          {sixLanguages ? <LanguagePicker className="min-h-11" /> : <LocaleSwitcher />}
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto flex w-full flex-1 flex-col px-4 py-6 focus:outline-none sm:justify-center sm:px-6 sm:py-10', WIDTH[width])}
      >
        {plain ? (
          children
        ) : (
          <div className="w-full sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-card">{children}</div>
        )}
      </main>

      <footer className="px-4 pb-6 pt-2">
        <nav aria-label={t('shell.footerLabel')} className="flex flex-wrap items-center justify-center gap-x-1 text-sm text-muted">
          <Link href="/accessibility" className="inline-flex min-h-11 items-center px-2 hover:text-ink hover:underline">
            {t('shell.accessibility')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-ink hover:underline">
            {t('shell.privacy')}
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms" className="inline-flex min-h-11 items-center px-2 hover:text-ink hover:underline">
            {t('shell.terms')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}

/** `<title>` for an auth route: "כניסה · RestoMatch". */
export async function authTitle(key: MessageKey<typeof authMessages.he>) {
  const t = await getT(authMessages);
  return { title: { absolute: `${t(key)} · RestoMatch` } };
}
