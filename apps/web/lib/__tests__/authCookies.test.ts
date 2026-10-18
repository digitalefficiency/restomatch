import { describe, expect, it } from 'vitest';
import { authCookieConfig, resolveUseSecureCookies } from '../authCookies';

describe('resolveUseSecureCookies', () => {
  it('uses Secure cookies for an https deployment URL', () => {
    expect(resolveUseSecureCookies({ AUTH_URL: 'https://app.restomatch.co.il' })).toBe(true);
  });

  it('does NOT use Secure cookies for an http (local) URL', () => {
    expect(resolveUseSecureCookies({ AUTH_URL: 'http://localhost:3000' })).toBe(false);
  });

  it('falls back to NODE_ENV when no URL is set (matches Auth.js)', () => {
    expect(resolveUseSecureCookies({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveUseSecureCookies({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveUseSecureCookies({})).toBe(false);
  });

  it('prefers AUTH_URL, then NEXTAUTH_URL, then APP_URL', () => {
    expect(
      resolveUseSecureCookies({ NEXTAUTH_URL: 'https://x.example', NODE_ENV: 'development' }),
    ).toBe(true);
    expect(resolveUseSecureCookies({ APP_URL: 'https://x.example' })).toBe(true);
  });
});

describe('authCookieConfig (production-like, secure)', () => {
  const cfg = authCookieConfig(true);

  it('pins HttpOnly + Secure + SameSite=Lax on every cookie', () => {
    for (const cookie of [cfg.sessionToken, cfg.callbackUrl, cfg.csrfToken]) {
      expect(cookie.options.httpOnly).toBe(true);
      expect(cookie.options.secure).toBe(true);
      expect(cookie.options.sameSite).toBe('lax');
      expect(cookie.options.path).toBe('/');
    }
  });

  it('reproduces Auth.js secure name prefixes exactly (no session invalidation)', () => {
    expect(cfg.sessionToken.name).toBe('__Secure-authjs.session-token');
    expect(cfg.callbackUrl.name).toBe('__Secure-authjs.callback-url');
    expect(cfg.csrfToken.name).toBe('__Host-authjs.csrf-token');
  });
});

describe('authCookieConfig (dev, insecure)', () => {
  const cfg = authCookieConfig(false);

  it('drops the Secure flag and name prefixes for http dev', () => {
    expect(cfg.sessionToken.options.secure).toBe(false);
    expect(cfg.sessionToken.name).toBe('authjs.session-token');
    expect(cfg.callbackUrl.name).toBe('authjs.callback-url');
    expect(cfg.csrfToken.name).toBe('authjs.csrf-token');
  });
});
