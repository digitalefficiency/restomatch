import type { Metadata } from 'next';
import type { Locale } from '@/lib/i18n/config';

/**
 * Canonical origin for SEO surfaces (metadataBase, sitemap, robots, JSON-LD).
 * APP_URL is the deployed origin (lib/env.ts); localhost is only the dev fallback.
 */
export function siteUrl(): string {
  return (process.env.APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}
/** Module-load value (pages render per request, so this is the runtime env). */
export const SITE_URL = siteUrl();

/** Public marketing routes (sitemap + hreflang). */
export const MARKETING_ROUTES = ['/', '/pricing', '/about', '/showcase', '/privacy', '/terms', '/cookies'] as const;

/**
 * hreflang alternates + per-locale canonical: Hebrew at the bare URL, English at
 * `?lang=en` (middleware sets the locale cookie from it).
 */
export function alternatesFor(path: string, locale: Locale = 'he'): NonNullable<Metadata['alternates']> {
  return {
    // Self-referencing canonical per language: the English page is its own
    // document (`?lang=en`), not a duplicate of the Hebrew one.
    canonical: locale === 'en' ? `${SITE_URL}${path}?lang=en` : `${SITE_URL}${path}`,
    languages: {
      he: `${SITE_URL}${path}`,
      en: `${SITE_URL}${path}?lang=en`,
      'x-default': `${SITE_URL}${path}`,
    },
  };
}

/** Absolute base for every relative URL in a page's metadata (OG, hreflang, canonical). */
export const metadataBase = new URL(SITE_URL);

/** Per-locale share card (app/og/[file]/route.tsx): Hebrew by default, English for `?lang=en`. */
export function ogImageFor(locale: Locale) {
  return {
    url: `/og/${locale}.png`,
    width: 1200,
    height: 630,
    alt:
      locale === 'he'
        ? 'RestoMatch — התאמת הזמנה, קבלת סחורה וחשבונית למסעדות'
        : 'RestoMatch — invoice, order and delivery matching for restaurants',
  };
}

/**
 * Open Graph + Twitter for a page, with the card in the viewer's language.
 * Next replaces (not merges) a page's `openGraph`/`twitter` over the layout's,
 * so every page that sets them goes through here to keep the image + card type.
 */
export function socialFor(
  locale: Locale,
  { title, description, path }: { title?: string; description?: string; path?: string } = {},
): Pick<Metadata, 'openGraph' | 'twitter'> {
  const image = ogImageFor(locale);
  // og:url is what Facebook/LinkedIn re-scrape, so it must be this language's
  // own URL (English lives at ?lang=en). Absolute: Next collapses `/?lang=en`.
  const url = path === undefined ? undefined : locale === 'en' ? `${SITE_URL}${path}?lang=en` : `${SITE_URL}${path}`;
  const text = { ...(title ? { title } : {}), ...(description ? { description } : {}) };
  return {
    openGraph: {
      type: 'website',
      siteName: 'RestoMatch',
      locale: locale === 'he' ? 'he_IL' : 'en_US',
      alternateLocale: locale === 'he' ? ['en_US'] : ['he_IL'],
      ...text,
      ...(url ? { url } : {}),
      images: [image],
    },
    twitter: { card: 'summary_large_image', ...text, images: [image] },
  };
}
