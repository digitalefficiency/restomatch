import type { MetadataRoute } from 'next';
import { MARKETING_ROUTES, siteUrl } from './(marketing)/_components/seo';

// Read APP_URL per request: the production domain is right without a rebuild.
export const dynamic = 'force-dynamic';

/** Public pages, each with its English (`?lang=en`) hreflang alternate. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const SITE_URL = siteUrl();
  return MARKETING_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: now,
    changeFrequency: route === '/' ? 'weekly' : 'monthly',
    priority: route === '/' ? 1 : route === '/pricing' ? 0.8 : 0.5,
    alternates: {
      languages: {
        he: `${SITE_URL}${route}`,
        en: `${SITE_URL}${route}?lang=en`,
      },
    },
  }));
}
