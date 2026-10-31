import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { preload } from 'react-dom';
import { CookieConsent } from '@/lib/components/CookieConsent';
import { ChromeMetrics } from '@/lib/components/overlay/ChromeMetrics';
import { RouteProgress } from '@/lib/components/RouteProgress';
import { CONSENT_COOKIE, readConsentFrom } from '@/lib/cookieConsent';
import { I18nProvider } from '@/lib/i18n/client';
import { baseLocaleOf, dirOf } from '@/lib/i18n/config';
import { getAppLocale, getLocale } from '@/lib/i18n/server';
import { metadataBase, socialFor } from './(marketing)/_components/seo';
import './globals.css';

// Fonts are self-hosted (public/fonts, @font-face in globals.css): Heebo for
// Hebrew, display and money; JetBrains Mono for identifiers only. Preload the Heebo
// subsets the page's language paints with so text doesn't flash on first load
// (an English page preloading the Hebrew subset drew Chrome's "preloaded but
// not used within a few seconds" warning).
const FONT_PRELOADS = {
  he: ['/fonts/heebo/heebo-hebrew-wght.woff2', '/fonts/heebo/heebo-latin-wght.woff2'],
  en: ['/fonts/heebo/heebo-latin-wght.woff2'],
} as const;

// `viewport-fit=cover` so env(safe-area-inset-*) resolves on notched phones;
// `resizes-content` so fixed footers rise above the Android keyboard (mobile-field-22).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#F6F8F7',
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const description =
    locale === 'he'
      ? 'התאמת חשבוניות, הזמנות וקבלת סחורה למסעדות'
      : 'Invoice, order and goods-receipt matching for restaurants';
  return {
    // The default for pages without their own title. Pages pass complete titles
    // ("מחירים · RestoMatch"); area layouts may add their own template (a11y-04).
    title: { default: 'RestoMatch', template: '%s' },
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
  // The consent cookie is read here so the banner renders (or not) in the first paint.
  const consent = (await cookies()).get(CONSENT_COOKIE)?.value;
  const consentDecided = readConsentFrom(consent ? `${CONSENT_COOKIE}=${consent}` : null) !== null;
  for (const href of FONT_PRELOADS[baseLocaleOf(locale)]) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <I18nProvider locale={locale}>
          {/* First in the DOM, so it is the first stop in the focus order (a11y-12). */}
          <CookieConsent decided={consentDecided} />
          {/* tRPC/react-query is provided by the routes that use it (dashboard, admin,
              onboarding, the lazy lead form) so public pages don't ship it. */}
          {props.children}
          <ChromeMetrics />
          <RouteProgress />
        </I18nProvider>
      </body>
    </html>
  );
}
