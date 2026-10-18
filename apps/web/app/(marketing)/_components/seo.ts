import type { Metadata } from 'next';

/**
 * Canonical origin for SEO surfaces (metadataBase, sitemap, robots, JSON-LD).
 * APP_URL is the deployed origin (lib/env.ts); localhost is only the dev fallback.
 */
export const SITE_URL = (process.env.APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Public marketing routes (sitemap + hreflang). */
export const MARKETING_ROUTES = ['/', '/pricing', '/about', '/showcase', '/privacy', '/terms', '/cookies'] as const;

/**
 * hreflang alternates: Hebrew is the canonical URL; English is the same page
 * with `?lang=en` (middleware sets the locale cookie from it).
 */
export function alternatesFor(path: string): NonNullable<Metadata['alternates']> {
  return {
    canonical: `${SITE_URL}${path}`,
    languages: {
      he: `${SITE_URL}${path}`,
      en: `${SITE_URL}${path}?lang=en`,
      'x-default': `${SITE_URL}${path}`,
    },
  };
}

/** Absolute base for every relative URL in a page's metadata (OG, hreflang, canonical). */
export const metadataBase = new URL(SITE_URL);
