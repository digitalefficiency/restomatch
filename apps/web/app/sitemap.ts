import type { MetadataRoute } from 'next';
import { MARKETING_ROUTES, SITE_URL } from './(marketing)/_components/seo';

/** Public pages, each with its English (`?lang=en`) hreflang alternate. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
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
