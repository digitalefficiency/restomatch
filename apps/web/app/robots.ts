import type { MetadataRoute } from 'next';
import { SITE_URL } from './(marketing)/_components/seo';

/** Marketing + demo are crawlable; the app, auth and API surfaces are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/about', '/showcase', '/privacy', '/terms', '/cookies'],
        disallow: ['/dashboard', '/admin', '/api/', '/login', '/reset', '/onboarding', '/invite', '/scans', '/set-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
