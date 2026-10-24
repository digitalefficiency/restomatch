import type { MetadataRoute } from 'next';
import { siteUrl } from './(marketing)/_components/seo';

// Read APP_URL per request: the production domain is right without a rebuild.
export const dynamic = 'force-dynamic';

/** Marketing + demo are crawlable; the app, auth and API surfaces are not. */
export default function robots(): MetadataRoute.Robots {
  const SITE_URL = siteUrl();
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
