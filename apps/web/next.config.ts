import type { NextConfig } from 'next';
import { baselineSecurityHeaders } from './lib/securityHeaders';

const config: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version (fingerprinting aid) — D1.1.
  poweredByHeader: false,
  // `next build` type-checks for real. The old `ignoreBuildErrors` escape hatch
  // (an "AppRouter inference drops routers" report) did not reproduce on a clean
  // checkout — 925k instantiations, ~20s, 0 errors across repeated runs; the
  // likely source was the iCloud-evicted ~/Desktop replica with dataless files.
  // test/appRouterShape.test.ts pins the inferred router keys so a regression
  // fails tsc loudly instead of silently.
  typescript: { ignoreBuildErrors: false },
  // Lint runs as its own step (`pnpm lint`, eslint.config.mjs), not inside build.
  eslint: { ignoreDuringBuilds: true },
  // Next streams generateMetadata into <body> for most user agents. Crawlers and
  // link-unfurlers listed here get blocking metadata in <head> instead, so the
  // landing/showcase titles, descriptions and OG tags are seen (S6 SEO ask).
  htmlLimitedBots:
    /Googlebot|Google-InspectionTool|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Applebot|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|Pinterest/i,
  transpilePackages: [
    '@restomatch/api',
    '@restomatch/charts',
    '@restomatch/db',
    '@restomatch/observability',
    '@restomatch/ocr',
    '@restomatch/queue',
    '@restomatch/translate',
    '@restomatch/types',
    '@restomatch/ui-tokens',
  ],
  // @sentry/node: optional, loaded at runtime by @restomatch/observability — never bundled.
  serverExternalPackages: ['nodemailer', 'postgres', '@anthropic-ai/sdk', '@sentry/node'],
  // Baseline security headers on EVERY response (incl. static assets the
  // middleware short-circuits). The per-request, nonce-based CSP is set in
  // middleware (it needs a fresh nonce); these are static — D1.1.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: baselineSecurityHeaders(),
      },
    ];
  },
};

export default config;
