import type { Metadata } from 'next';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { showcase } from '@/lib/i18n/messages/showcase';
import { getT } from '@/lib/i18n/server';
import { metadataBase } from '../(marketing)/_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(showcase);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    metadataBase,
    openGraph: { title: t('meta.title'), description: t('meta.description'), url: '/showcase' },
  };
}

export default async function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  const t = await getT(showcase);

  return (
    <div
      className="min-h-screen bg-bg text-ink"
      style={{
        fontFamily: 'var(--font-heebo), "Heebo", system-ui, sans-serif',
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(34, 211, 154, 0.10), transparent 60%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2 lg:py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/showcase"
            className="text-lg font-bold tracking-tight flex items-baseline gap-2 shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="flow-accent bg-clip-text text-transparent" lang="en" dir="ltr">
              RestoMatch
            </span>
            <span className="text-muted text-xs font-normal">{t('layout.brandTag')}</span>
          </Link>

          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn shrink-0"
            title={t('layout.demoNote')}
          >
            <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
            {t('layout.demoBadge')}
          </span>

          <div className="ms-auto flex items-center gap-2 shrink-0">
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
              {t('layout.backToSite')}
            </Link>
            <Link
              href="/#lead"
              className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-glow-primary hover:brightness-110 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {t('layout.cta')}
            </Link>
            <LocaleSwitcher />
          </div>

          <nav
            aria-label={t('layout.navLabel')}
            className="order-last lg:order-none w-full lg:w-auto lg:ms-2 -mx-1 flex gap-1 overflow-x-auto text-sm whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <ShowcaseLink href="/showcase/receiver">{t('layout.nav.receiver')}</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard">{t('layout.nav.dashboard')}</ShowcaseLink>
            <ShowcaseLink href="/showcase/dashboard/invoices">{t('layout.nav.invoices')}</ShowcaseLink>
            <ShowcaseLink href="/showcase/deliveries">{t('layout.nav.deliveries')}</ShowcaseLink>
            <ShowcaseLink href="/showcase/approvals">{t('layout.nav.approvals')}</ShowcaseLink>
          </nav>
        </div>
        <div className="border-t border-line/60 bg-warn/[0.04]">
          <p className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 text-[11px] leading-snug text-muted">
            {t('layout.demoNote')}
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}

function ShowcaseLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 px-3 py-1.5 rounded-md text-muted hover:text-primary hover:bg-surface-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {children}
    </Link>
  );
}
