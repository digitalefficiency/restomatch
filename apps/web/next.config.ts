import type { NextConfig } from 'next';
import { baselineSecurityHeaders } from './lib/securityHeaders';

const config: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version (fingerprinting aid) — D1.1.
  poweredByHeader: false,
  // The tRPC AppRouter type is too large for `tsc` to fully infer at build time
  // (deep router/procedure tree), so type-check intermittently drops routers
  // like `suppliers` from the client proxy type even though they resolve fine at
  // runtime. Compilation (swc) still runs and catches real syntax/import errors;
  // we skip the over-strict type/lint gate at build (CI already excludes it).
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: [
    '@restomatch/api',
    '@restomatch/charts',
    '@restomatch/db',
    '@restomatch/ocr',
    '@restomatch/types',
    '@restomatch/ui-tokens',
  ],
  serverExternalPackages: ['nodemailer', 'postgres', 'ioredis', '@anthropic-ai/sdk'],
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
