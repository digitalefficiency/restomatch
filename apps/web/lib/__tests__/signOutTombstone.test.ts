import { describe, expect, it } from 'vitest';
import { SIGNOUT_COOKIE, issuedBeforeSignOut, signOutCookieOptions } from '../signOutTombstone';
import { SESSION_TTL_LONG_SEC } from '../sessionLifetime';

describe('sign-out tombstone', () => {
  const signedOutAt = 1_800_000_000_000;

  it('rejects a token issued before (or at) this browser signed out — the re-planted cookie', () => {
    expect(issuedBeforeSignOut(signedOutAt - 60_000, String(signedOutAt))).toBe(true);
    expect(issuedBeforeSignOut(signedOutAt, String(signedOutAt))).toBe(true);
  });

  it('accepts a fresh sign-in after the sign-out (presenter switches owner → receiver)', () => {
    expect(issuedBeforeSignOut(signedOutAt + 1, String(signedOutAt))).toBe(false);
  });

  it('no / malformed tombstone never rejects anything', () => {
    expect(issuedBeforeSignOut(signedOutAt, undefined)).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, '')).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, 'garbage')).toBe(false);
    expect(issuedBeforeSignOut(signedOutAt, '-5')).toBe(false);
  });

  it('a token without loginAt (pre-B.5) counts as oldest', () => {
    expect(issuedBeforeSignOut(undefined, String(signedOutAt))).toBe(true);
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
