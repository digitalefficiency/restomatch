import { describe, expect, it } from 'vitest';
import {
  baselineSecurityHeaders,
  buildCsp,
  cspHeaderName,
  generateNonce,
  isCspReportOnly,
} from '../securityHeaders';

describe('baselineSecurityHeaders', () => {
  const headers = baselineSecurityHeaders();
  const byKey = (k: string) => headers.find((h) => h.key === k)?.value;

  it('sets HSTS with >= 180-day max-age, includeSubDomains and preload', () => {
    const hsts = byKey('Strict-Transport-Security');
    expect(hsts).toBeDefined();
    const maxAge = Number(/max-age=(\d+)/.exec(hsts!)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(15552000);
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');
  });

  it('denies framing and content-type sniffing', () => {
    expect(byKey('X-Frame-Options')).toBe('DENY');
    expect(byKey('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets a privacy-preserving Referrer-Policy', () => {
    expect(byKey('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('locks down powerful Permissions-Policy features', () => {
    const pp = byKey('Permissions-Policy');
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
  });

  it('exposes every required header exactly once', () => {
    const required = [
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ];
    for (const key of required) {
      expect(headers.filter((h) => h.key === key)).toHaveLength(1);
    }
  });
});

describe('generateNonce', () => {
  it('returns a fresh, base64, sufficiently long nonce each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // 16 random bytes => 24 base64 chars.
    expect(a.length).toBeGreaterThanOrEqual(20);
  });
});

describe('buildCsp', () => {
  const csp = buildCsp('TESTNONCE');

  it('embeds the nonce and strict-dynamic in script-src', () => {
    expect(csp).toContain(`script-src 'self' 'nonce-TESTNONCE' 'strict-dynamic'`);
  });

  it('closes object/base/frame-ancestors', () => {
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`base-uri 'none'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`form-action 'self'`);
  });
});

describe('CSP header naming', () => {
  it('defaults to Report-Only and flips with CSP_ENFORCE=1', () => {
    expect(isCspReportOnly({})).toBe(true);
    expect(isCspReportOnly({ CSP_ENFORCE: '0' })).toBe(true);
    expect(isCspReportOnly({ CSP_ENFORCE: '1' })).toBe(false);
  });

  it('maps the report-only flag to the right header name', () => {
    expect(cspHeaderName(true)).toBe('content-security-policy-report-only');
    expect(cspHeaderName(false)).toBe('content-security-policy');
  });
});
