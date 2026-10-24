import Link from 'next/link';
import { Menu, Receipt } from 'lucide-react';
import { leakCheck as lc } from '@restomatch/api';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { AnchorScrollFix } from './AnchorScrollFix';

const NAV_BASE = [
  { href: '/#how', key: 'shell.nav.how' },
  { href: '/about#features', key: 'shell.nav.features' },
  { href: '/pricing', key: 'shell.nav.pricing' },
  { href: '/showcase', key: 'shell.nav.demo' },
  { href: '/about', key: 'shell.nav.about' },
] as const;

/**
 * The public free-leak-check page (S15) is env-gated: LEAK_CHECK_PUBLIC=1, and
 * the FEATURES_OFF kill-switch (leakCheck / all) wins — the same check the
 * pages and APIs use, so the nav never links to a 404. Read at request time on
 * the server, so flipping the env needs no rebuild.
 */
function leakCheckPublic(): boolean {
  return lc.leakCheckPublicEnabled();
}

const LEAK_CHECK = { href: '/leak-check', key: 'shell.nav.leakCheck' } as const;

function Logo({ small = false }: { small?: boolean }) {
  return (
    <span
      className={
        'flex items-center justify-center bg-primary text-on-primary shadow-glow-primary ' +
        (small ? 'h-8 w-8 rounded-lg' : 'h-9 w-9 rounded-xl')
      }
    >
      <Receipt className={small ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
    </span>
  );
}

/**
 * Marketing chrome (nav + footer) shared by the route-group layout AND the
 * root homepage (`app/page.tsx` lives outside the `(marketing)` group, so it
 * can't inherit that layout — it wraps itself in this shell instead).
 *
 * The mobile menu is a native <details> disclosure — no client JS needed.
 */
export async function MarketingShell({ children }: { children: React.ReactNode }) {
  const t = await getT(marketing);
  const year = new Date().getFullYear();
  const leakCheck = leakCheckPublic();
  const NAV = leakCheck ? [...NAV_BASE.slice(0, 3), LEAK_CHECK, ...NAV_BASE.slice(3)] : NAV_BASE;
  const link =
    'rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t('shell.skip')}
      </a>
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-xl text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            aria-label={t('shell.homeLabel')}
          >
            <Logo />
            <span className="text-lg font-bold tracking-tight">RestoMatch</span>
          </Link>

          <nav aria-label={t('shell.navLabel')} className="hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={link}>
                {t(n.key)}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link
              href="/login"
              className="hidden items-center rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:inline-flex"
            >
              {t('shell.login')}
            </Link>
            <Link
              href="/#lead"
              className="hidden items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:inline-flex"
            >
              {t('shell.cta')}
            </Link>
            <details className="group relative lg:hidden">
              <summary
                aria-label={t('shell.menuOpen')}
                className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-line bg-surface-2 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </summary>
              <nav
                aria-label={t('shell.navLabel')}
                className="absolute end-0 top-12 z-50 flex w-60 flex-col gap-0.5 rounded-2xl border border-line bg-surface p-2 shadow-card"
              >
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className={link}>
                    {t(n.key)}
                  </Link>
                ))}
                <Link href="/login" className={link}>
                  {t('shell.login')}
                </Link>
                <Link
                  href="/#lead"
                  className="mt-1 rounded-xl bg-primary px-3 py-2.5 text-center text-sm font-semibold text-on-primary"
                >
                  {t('shell.cta')}
                </Link>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <AnchorScrollFix />
      <footer className="rm-defer border-t border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5 text-ink">
                <Logo small />
                <span className="text-base font-bold tracking-tight">RestoMatch</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t('shell.footerTagline')}</p>
              <p className="mt-3 text-xs text-muted">{t('shell.madeIn')}</p>
            </div>

            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 sm:gap-16">
              <nav aria-label={t('shell.footerLinksLabel')} className="flex flex-col gap-2 text-sm">
                <span className="mb-1 text-xs font-semibold uppercase text-muted ltr:font-mono ltr:tracking-[0.18em]">
                  {t('shell.footerProduct')}
                </span>
                <Link href="/#how" className="text-muted hover:text-ink">
                  {t('shell.nav.how')}
                </Link>
                <Link href="/about#features" className="text-muted hover:text-ink">
                  {t('shell.nav.features')}
                </Link>
                <Link href="/pricing" className="text-muted hover:text-ink">
                  {t('shell.nav.pricing')}
                </Link>
                {leakCheck ? (
                  <Link href={LEAK_CHECK.href} className="text-muted hover:text-ink">
                    {t(LEAK_CHECK.key)}
                  </Link>
                ) : null}
                <Link href="/showcase" className="text-muted hover:text-ink">
                  {t('shell.nav.demo')}
                </Link>
              </nav>
              <nav aria-label={t('shell.footerCompany')} className="flex flex-col gap-2 text-sm">
                <span className="mb-1 text-xs font-semibold uppercase text-muted ltr:font-mono ltr:tracking-[0.18em]">
                  {t('shell.footerCompany')}
                </span>
                <Link href="/about" className="text-muted hover:text-ink">
                  {t('shell.nav.about')}
                </Link>
                <Link href="/#lead" className="text-muted hover:text-ink">
                  {t('shell.contact')}
                </Link>
                <Link href="/login" className="text-muted hover:text-ink">
                  {t('shell.loginFull')}
                </Link>
              </nav>
              <nav aria-label={t('shell.footerLegalLabel')} className="flex flex-col gap-2 text-sm">
                <span className="mb-1 text-xs font-semibold uppercase text-muted ltr:font-mono ltr:tracking-[0.18em]">
                  {t('shell.footerLegal')}
                </span>
                <Link href="/privacy" className="text-muted hover:text-ink">
                  {t('shell.privacy')}
                </Link>
                <Link href="/terms" className="text-muted hover:text-ink">
                  {t('shell.terms')}
                </Link>
                <Link href="/cookies" className="text-muted hover:text-ink">
                  {t('shell.cookies')}
                </Link>
              </nav>
            </div>
          </div>

          <div className="mt-10 border-t border-line pt-6 font-mono text-xs tabular-nums text-muted">
            {t('shell.rights', { year })}
          </div>
        </div>
      </footer>
    </div>
  );
}
