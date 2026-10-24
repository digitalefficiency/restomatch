import { describe, expect, it } from 'vitest';
import { SIGNOUT_COOKIE, SIGNOUT_FUTURE_SKEW_MS, issuedBeforeSignOut, signOutCookieOptions } from '../signOutTombstone';
import { SESSION_TTL_LONG_SEC } from '../sessionLifetime';

describe('sign-out tombstone', () => {
  const signedOutAt = 1_800_000_000_000;
  const now = signedOutAt + 5_000; // a few seconds after the sign-out

  it('rejects a token issued before (or at) this browser signed out — the re-planted cookie', () => {
    expect(issuedBeforeSignOut(signedOutAt - 60_000, String(signedOutAt), now)).toBe(true);
    expect(issuedBeforeSignOut(signedOutAt, String(signedOutAt), now)).toBe(true);
  });

  it('accepts a fresh sign-in after the sign-out (presenter switches owner → receiver)', () => {
    expect(issuedBeforeSignOut(signedOutAt + 1, String(signedOutAt), now)).toBe(false);
  });

  it('no / malformed tombstone never rejects anything', () => {
    expect(issuedBeforeSignOut(signedOutAt, undefined, now)).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, '', now)).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, 'garbage', now)).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, '-5', now)).toBe(false);
  });

  it('a tombstone from the future is ignored (forged rm_so must not lock the browser out)', () => {
    const forged = String(now + 30 * 24 * 60 * 60 * 1000);
    expect(issuedBeforeSignOut(now - 1_000, forged, now)).toBe(false);
    // Within the clock-skew allowance it still counts.
    expect(issuedBeforeSignOut(now - 1_000, String(now + SIGNOUT_FUTURE_SKEW_MS), now)).toBe(true);
    expect(issuedBeforeSignOut(now - 1_000, String(now + SIGNOUT_FUTURE_SKEW_MS + 1), now)).toBe(false);
  });

  it('a token without loginAt (pre-B.5) counts as oldest', () => {
    expect(issuedBeforeSignOut(undefined, String(signedOutAt), now)).toBe(true);
  });

  it('cookie is HttpOnly, Lax, site-wide, and outlives the longest session', () => {
    expect(SIGNOUT_COOKIE).toBe('rm_so');
    expect(signOutCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: SESSION_TTL_LONG_SEC,
    });
    expect(signOutCookieOptions(false).secure).toBe(false);
  });
});
