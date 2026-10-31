import Link from 'next/link';
import { Mail, MessageCircle, Phone, Receipt } from 'lucide-react';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { contactChannels } from '@/lib/contact';
import { AnchorScrollFix } from './AnchorScrollFix';
import { Attribution } from './Attribution';
import { MobileMenu } from './MobileMenu';
import { StickyCta } from './StickyCta';
import { leakCheckPublic, primaryCtaHref, whatsappLink } from './cta';

const NAV_BASE = [
  { href: '/#how', key: 'shell.nav.how' },
  { href: '/about#features', key: 'shell.nav.features' },
  { href: '/pricing', key: 'shell.nav.pricing' },
  { href: '/showcase', key: 'shell.nav.demo' },
  { href: '/about', key: 'shell.nav.about' },
] as const;

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
 * Below lg the nav is a client sheet (MobileMenu); below md a sticky CTA bar
 * follows the visitor once the hero CTA has scrolled away (StickyCta). Every
 * "בדיקת דליפה חינם" goes to the same place (primaryCtaHref).
 */
export async function MarketingShell({ children }: { children: React.ReactNode }) {
  const t = await getT(marketing);
  const year = new Date().getFullYear();
  const leakCheck = leakCheckPublic();
  const NAV = leakCheck ? [...NAV_BASE.slice(0, 3), LEAK_CHECK, ...NAV_BASE.slice(3)] : NAV_BASE;
  const ctaHref = primaryCtaHref();
  const channels = contactChannels();
  const wa = whatsappLink(t('shell.whatsappText'));
  const whatsapp = wa ? { href: wa, label: t('shell.whatsapp') } : null;
  const link =
    'touch-target flex items-center rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

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
            className="touch-target flex items-center gap-2.5 rounded-xl text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
              href={ctaHref}
              className="hidden items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:inline-flex"
            >
              {t('shell.cta')}
            </Link>
            <MobileMenu
              items={NAV.map((n) => ({ href: n.href, label: t(n.key) }))}
              login={{ href: '/login', label: t('shell.login') }}
              cta={{ href: ctaHref, label: t('shell.cta') }}
              whatsapp={whatsapp ? { href: whatsapp.href, label: t('shell.whatsappLabel') } : null}
              labels={{
                open: t('shell.menuOpen'),
                close: t('shell.menuClose'),
                title: t('shell.menuTitle'),
                nav: t('shell.navLabel'),
              }}
            />
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <AnchorScrollFix />
      <Attribution />
      <StickyCta cta={{ href: ctaHref, label: t('shell.cta') }} whatsapp={whatsapp} label={t('shell.stickyLabel')} />
      <footer data-site-footer className="rm-defer border-t border-line bg-surface/40">
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
                <Link href="/#how" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.nav.how')}
                </Link>
                <Link href="/about#features" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.nav.features')}
                </Link>
                <Link href="/pricing" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.nav.pricing')}
                </Link>
                {leakCheck ? (
                  <Link href={LEAK_CHECK.href} className="touch-target inline-flex items-center text-muted hover:text-ink">
                    {t(LEAK_CHECK.key)}
                  </Link>
                ) : null}
                <Link href="/showcase" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.nav.demo')}
                </Link>
              </nav>
              <nav aria-label={t('shell.footerCompany')} className="flex flex-col gap-2 text-sm">
                <span className="mb-1 text-xs font-semibold uppercase text-muted ltr:font-mono ltr:tracking-[0.18em]">
                  {t('shell.footerCompany')}
                </span>
                <Link href="/about" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.nav.about')}
                </Link>
                <Link href="/#lead" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.contactFormLink')}
                </Link>
                {whatsapp ? (
                  <a
                    href={whatsapp.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="touch-target inline-flex items-center gap-1.5 text-muted hover:text-ink"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    {t('shell.whatsappLabel')}
                  </a>
                ) : null}
                {channels.phone ? (
                  <a href={channels.phone.href} className="touch-target inline-flex items-center gap-1.5 text-muted hover:text-ink">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {t('shell.phoneLabel')}:{' '}
                      <bdi dir="ltr">{channels.phone.display}</bdi>
                    </span>
                  </a>
                ) : null}
                {channels.email ? (
                  <a href={channels.email.href} className="touch-target inline-flex items-center gap-1.5 text-muted hover:text-ink">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {t('shell.emailLabel')}:{' '}
                      <bdi dir="ltr">{channels.email.address}</bdi>
                    </span>
                  </a>
                ) : null}
                <Link href="/login" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.loginFull')}
                </Link>
              </nav>
              <nav aria-label={t('shell.footerLegalLabel')} className="flex flex-col gap-2 text-sm">
                <span className="mb-1 text-xs font-semibold uppercase text-muted ltr:font-mono ltr:tracking-[0.18em]">
                  {t('shell.footerLegal')}
                </span>
                <Link href="/privacy" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.privacy')}
                </Link>
                <Link href="/terms" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.terms')}
                </Link>
                <Link href="/cookies" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.cookies')}
                </Link>
                <Link href="/accessibility" className="touch-target inline-flex items-center text-muted hover:text-ink">
                  {t('shell.accessibility')}
                </Link>
              </nav>
            </div>
          </div>

          <div className="mt-10 border-t border-line pt-6 text-xs tabular-nums text-muted">
            {t('shell.rights', { year })}
          </div>
        </div>
      </footer>
    </div>
  );
}
