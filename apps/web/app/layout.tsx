import type { Metadata } from 'next';
import { preload } from 'react-dom';
import { CookieConsent } from '@/lib/components/CookieConsent';
import { RouteProgress } from '@/lib/components/RouteProgress';
import { I18nProvider } from '@/lib/i18n/client';
import { dirOf } from '@/lib/i18n/config';
import { getAppLocale, getLocale } from '@/lib/i18n/server';
import './globals.css';

// Fonts are self-hosted (public/fonts, @font-face in globals.css): Heebo for
// Hebrew + display, JetBrains Mono for money figures. Preload the two Heebo
// subsets every page paints with so text doesn't flash on first load.
const FONT_PRELOADS = ['/fonts/heebo/heebo-hebrew-wght.woff2', '/fonts/heebo/heebo-latin-wght.woff2'];

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: 'RestoMatch',
    description:
      locale === 'he'
        ? 'התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות'
        : 'Invoice, order and goods-receipt matching for restaurants',
  };
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  // Locale comes from the `rm_locale` cookie (LocaleSwitcher / `?lang=`); the
  // document direction follows it so English renders LTR.
  const locale = await getAppLocale();
  for (const href of FONT_PRELOADS) {
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
          <RouteProgress />
        </I18nProvider>
      </body>
    </html>
  );
}
