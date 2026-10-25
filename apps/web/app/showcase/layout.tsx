import type { Metadata } from 'next';
import { showcase } from '@/lib/i18n/messages/showcase';
import { getT } from '@/lib/i18n/server';
import { metadataBase, socialFor } from '../(marketing)/_components/seo';
import { Attribution } from '../(marketing)/_components/Attribution';
import { primaryCtaHref } from '../(marketing)/_components/cta';
import { ShowcaseFooter } from './_components/ShowcaseFooter';
import { ShowcaseHeader } from './_components/ShowcaseHeader';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(showcase);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    metadataBase,
    ...socialFor(t.locale, { title: t('meta.title'), description: t('meta.description'), path: '/showcase' }),
  };
}

export default async function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  const t = await getT(showcase);
  const demos = [
    { href: '/showcase/receiver', label: t('layout.nav.receiver') },
    { href: '/showcase/dashboard', label: t('layout.nav.dashboard') },
    { href: '/showcase/dashboard/invoices', label: t('layout.nav.invoices') },
    { href: '/showcase/deliveries', label: t('layout.nav.deliveries') },
    { href: '/showcase/approvals', label: t('layout.nav.approvals') },
  ];

  return (
    <div
      className="min-h-screen bg-bg text-ink"
      style={{
        fontFamily: 'var(--font-heebo), "Heebo", system-ui, sans-serif',
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(6, 107, 74, 0.06), transparent 60%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <a
        href="#showcase-content"
        className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        {t('layout.skip')}
      </a>
      <Attribution />
      <ShowcaseHeader
        demos={demos}
        cta={{ href: primaryCtaHref(), label: t('layout.cta'), short: t('layout.ctaShort') }}
        labels={{
          brandTag: t('layout.brandTag'),
          nav: t('layout.navLabel'),
          pickDemo: t('layout.pickDemo'),
          pickDemoTitle: t('layout.pickDemoTitle'),
          closePicker: t('layout.closePicker'),
          badge: t('layout.brandTag'),
          note: t('layout.demoNote'),
          aboutDemo: t('layout.aboutDemo'),
          backToSite: t('layout.backToSite'),
        }}
      />
      {/* Skip-link target; each demo page renders its own <main>. */}
      <div id="showcase-content" tabIndex={-1} className="focus:outline-none">
        {children}
      </div>
      <ShowcaseFooter />
    </div>
  );
}
