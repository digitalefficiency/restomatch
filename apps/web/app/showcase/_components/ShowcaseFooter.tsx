import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { marketing } from '@/lib/i18n/messages/marketing';
import { showcase } from '@/lib/i18n/messages/showcase';
import { getT } from '@/lib/i18n/server';
import { contactChannels, whatsappHref } from '@/lib/contact';

/**
 * Showcase footer (W1-12 · mkt-16, a11y-01 / ia-nav-20): the demo disclaimer,
 * the way back to the site, and the same legal + accessibility links as the
 * marketing footer, at the same place (footer end).
 */
export async function ShowcaseFooter() {
  const t = await getT(showcase);
  const m = await getT(marketing);
  const wa = contactChannels().whatsapp;
  const link = 'touch-target inline-flex items-center text-muted hover:text-ink';
  return (
    <footer className="mt-16 border-t border-line bg-surface/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <p className="max-w-md text-sm leading-relaxed text-muted">{t('layout.demoNote')}</p>
        <nav
          aria-label={t('layout.footerLabel')}
          className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
        >
          <Link href="/" className={link}>
            {t('layout.backToSite')}
          </Link>
          <Link href="/pricing" className={link}>
            {m('shell.nav.pricing')}
          </Link>
          {wa ? (
            <a
              href={whatsappHref(wa.digits, m('shell.whatsappText'))}
              target="_blank"
              rel="noopener noreferrer"
              className={`${link} gap-1.5`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {m('shell.whatsappLabel')}
            </a>
          ) : null}
          <Link href="/privacy" className={link}>
            {m('shell.privacy')}
          </Link>
          <Link href="/terms" className={link}>
            {m('shell.terms')}
          </Link>
          <Link href="/accessibility" className={link}>
            {m('shell.accessibility')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
