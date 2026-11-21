import type { MetadataRoute } from 'next';
import { MARKETING_ROUTES, siteUrl } from './(marketing)/_components/seo';

// Read APP_URL per request: no code change per domain (on Vercel an env change
// still takes a redeploy to reach the running deployment).
export const dynamic = 'force-dynamic';

/**
 * Marketing + demo are crawlable; the app, auth and API surfaces are not.
 * `allow` derives from MARKETING_ROUTES (site pages + the legal registry, G-11),
 * so the accessibility statement and every legal page are always listed.
 */
export default function robots(): MetadataRoute.Robots {
  const SITE_URL = siteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: [...MARKETING_ROUTES],
        disallow: ['/dashboard', '/admin', '/api/', '/login', '/reset', '/onboarding', '/invite', '/scans', '/set-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
