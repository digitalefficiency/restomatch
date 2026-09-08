import { describe, expect, it } from 'vitest';
import { isPublicPath, looksLikeStaticAsset } from '../publicPaths';

describe('isPublicPath (middleware allowlist)', () => {
  it.each(['/', '/pricing', '/about', '/privacy', '/terms', '/cookies'])(
    'marketing + legal page %s is public',
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it('password reset is public, including the emailed token link', () => {
    expect(isPublicPath('/reset')).toBe(true);
    expect(isPublicPath('/reset/')).toBe(true);
  });

  it('login flow pages are public', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/login/2fa')).toBe(true);
    expect(isPublicPath('/login/check-email')).toBe(true);
  });

  it.each(['/api/auth/callback/nodemailer', '/api/trpc/leads.create', '/api/healthz', '/api/cron/worker-heartbeat', '/api/inbound/email', '/api/showcase/ocr'])(
    'per-request-authenticated API surface %s is not blocked by the page redirect',
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it.each(['/dashboard', '/dashboard/leaks', '/admin', '/admin/leads', '/scans/abc', '/set-password', '/onboarding', '/invite/accept'])(
    'protected route %s stays private',
    (p) => expect(isPublicPath(p)).toBe(false),
  );

  it('prefix matching respects path boundaries', () => {
    expect(isPublicPath('/resetting-things')).toBe(false);
    expect(isPublicPath('/loginx')).toBe(false);
    expect(isPublicPath('/privacy-internal')).toBe(false);
  });

  it('treats a dotted last segment as a static asset, but not a dot mid-path', () => {
    expect(looksLikeStaticAsset('/favicon.ico')).toBe(true);
    expect(isPublicPath('/images/logo.svg')).toBe(true);
    expect(looksLikeStaticAsset('/scans/id.with.dots/')).toBe(false);
    expect(isPublicPath('/scans/a.b')).toBe(true); // by design: last segment has an extension-like suffix
  });
});
