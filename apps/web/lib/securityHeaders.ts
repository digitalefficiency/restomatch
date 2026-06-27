/**
 * HTTP security headers — pure, dependency-free builders (D1.1 + D1.2).
 *
 * Split into two surfaces:
 *  - {@link baselineSecurityHeaders} — STATIC headers (HSTS, X-Frame-Options,
 *    X-Content-Type-Options, Referrer-Policy, Permissions-Policy). Emitted from
 *    `next.config.ts` `headers()` so they ride EVERY response (incl. static
 *    assets the middleware short-circuits).
 *  - {@link buildCsp} + {@link generateNonce} — the Content-Security-Policy,
 *    which needs a fresh per-request nonce and therefore lives in middleware.
 *
 * No imports on purpose: this module is loaded both by `next.config.ts` (config
 * load, before the app boots) and by the Edge middleware, and is unit-testable
 * in plain Node without a Next runtime.
 */

export interface HttpHeader {
  key: string;
  value: string;
}

/**
 * Static, request-independent security headers.
 *
 * HSTS uses a 2-year max-age (>= the 180-day preload minimum) with
 * includeSubDomains + preload. Permissions-Policy denies the powerful features
 * this app never uses (camera/mic/geo/payment) and opts out of Topics/FLoC.
 */
export function baselineSecurityHeaders(): HttpHeader[] {
  return [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()',
    },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
}

/**
 * Cryptographically-random per-request nonce (base64, 128 bits). Uses Web
 * Crypto (`globalThis.crypto`), available in both the Edge runtime and Node 20+,
 * so it works in middleware and in tests without a Buffer polyfill.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Strict, nonce-based Content-Security-Policy.
 *
 * `script-src 'nonce-…' 'strict-dynamic'` is the modern hardening: scripts must
 * carry the per-request nonce, and scripts they load inherit trust via
 * strict-dynamic — host allowlists and `'unsafe-inline'` are then ignored by
 * CSP3 browsers (the `https:`/`'unsafe-inline'` fallbacks only matter for legacy
 * browsers that don't understand strict-dynamic). `object-src 'none'`,
 * `base-uri 'none'` and `frame-ancestors 'none'` close clickjacking / base-tag
 * injection. `style-src 'unsafe-inline'` is required by next/font + Tailwind's
 * injected styles.
 */
export function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https:`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
}

/**
 * The CSP header name. We ship `Content-Security-Policy-Report-Only` by default
 * so a mis-scoped policy reports violations instead of breaking the app; flip to
 * the enforcing header by setting `CSP_ENFORCE=1` once the report stream is
 * clean. See PR notes for the promotion runbook.
 */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'content-security-policy-report-only' : 'content-security-policy';
}

/** True when CSP should be Report-Only (the safe default until `CSP_ENFORCE=1`). */
export function isCspReportOnly(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CSP_ENFORCE !== '1';
}
