import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_LONG_SEC,
  SESSION_TTL_SHORT_SEC,
  isSessionExpired,
  sessionLifetime,
} from '../lib/sessionLifetime';

describe('remember-me session lifetime (B.5)', () => {
  it('remember ON → persistent cookie with a long Max-Age + long token', () => {
    const on = sessionLifetime(true);
    expect(on.tokenTtlSec).toBe(SESSION_TTL_LONG_SEC);
    expect(on.cookieMaxAge).toBe(SESSION_TTL_LONG_SEC); // ~30d, persistent
  });

  it('remember OFF → a browser SESSION cookie (no Max-Age) + short token', () => {
    const off = sessionLifetime(false);
    expect(off.tokenTtlSec).toBe(SESSION_TTL_SHORT_SEC);
    expect(off.cookieMaxAge).toBeUndefined(); // session cookie — the default
  });

  it('the long window is meaningfully longer than the short one', () => {
    expect(SESSION_TTL_LONG_SEC).toBeGreaterThan(SESSION_TTL_SHORT_SEC);
  });

  it('enforces the absolute window from login time', () => {
    const loginAt = 1_000_000_000_000;
    // Just inside the short window → still valid for a non-remembered session.
    expect(isSessionExpired(loginAt, false, loginAt + SESSION_TTL_SHORT_SEC * 1000 - 1)).toBe(false);
    // Just past the short window → a non-remembered session is expired…
    expect(isSessionExpired(loginAt, false, loginAt + SESSION_TTL_SHORT_SEC * 1000 + 1)).toBe(true);
    // …but a remembered one is still alive at that same moment.
    expect(isSessionExpired(loginAt, true, loginAt + SESSION_TTL_SHORT_SEC * 1000 + 1)).toBe(false);
    // The remembered session also has an absolute cap.
    expect(isSessionExpired(loginAt, true, loginAt + SESSION_TTL_LONG_SEC * 1000 + 1)).toBe(true);
  });
});
