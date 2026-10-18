import type { Metadata } from 'next';
import { Heebo, JetBrains_Mono } from 'next/font/google';
import { TrpcProvider } from '@/lib/trpc/client';
import { CookieConsent } from '@/lib/components/CookieConsent';
import { I18nProvider } from '@/lib/i18n/client';
import { dirOf } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import './globals.css';

// Heebo drives Hebrew text + display (heavy weights for big numbers/headlines).
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
});

// JetBrains Mono powers money figures / KPIs (tabular, terminal feel).
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

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
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${heebo.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <I18nProvider locale={locale}>
          <TrpcProvider>{props.children}</TrpcProvider>
          <CookieConsent />
        </I18nProvider>
      </body>
    </html>
  );
}
