import type { Metadata } from 'next';
import { preload } from 'react-dom';
import { CookieConsent } from '@/lib/components/CookieConsent';
import { ConsentClearance } from './consent-clearance';
import { RouteProgress } from '@/lib/components/RouteProgress';
import { I18nProvider } from '@/lib/i18n/client';
import { baseLocaleOf, dirOf } from '@/lib/i18n/config';
import { getAppLocale, getLocale } from '@/lib/i18n/server';
import { metadataBase, socialFor } from './(marketing)/_components/seo';
import './globals.css';

// Fonts are self-hosted (public/fonts, @font-face in globals.css): Heebo for
// Hebrew + display, JetBrains Mono for money figures. Preload the Heebo
// subsets the page's language paints with so text doesn't flash on first load
// (an English page preloading the Hebrew subset drew Chrome's "preloaded but
// not used within a few seconds" warning).
const FONT_PRELOADS = {
  he: ['/fonts/heebo/heebo-hebrew-wght.woff2', '/fonts/heebo/heebo-latin-wght.woff2'],
  en: ['/fonts/heebo/heebo-latin-wght.woff2'],
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const description =
    locale === 'he'
      ? 'התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות'
      : 'Invoice, order and goods-receipt matching for restaurants';
  return {
    title: 'RestoMatch',
    description,
    metadataBase,
    // Image + card type only: pages without their own share text fall back to <title>.
    ...socialFor(locale),
  };
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  // Locale comes from the `rm_locale` cookie (LocaleSwitcher / `?lang=`); the
  // document direction follows it so English renders LTR.
  // A receiver locale (ar/ru/th/ti) preloads its base locale's subsets.
  const locale = await getAppLocale();
  for (const href of FONT_PRELOADS[baseLocaleOf(locale)]) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <I18nProvider locale={locale}>
          {/* tRPC/react-query is provided by the routes that use it (dashboard, admin,
              onboarding, the lazy lead form) so public pages don't ship it. */}
          {props.children}
          <CookieConsent />
          <ConsentClearance />
          <RouteProgress />
        </I18nProvider>
      </body>
    </html>
  );
}
