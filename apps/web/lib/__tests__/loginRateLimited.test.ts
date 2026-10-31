import { describe, expect, it, vi } from 'vitest';
import { AuthError, CredentialsSignin } from 'next-auth';

// next-auth's entry imports `next/server`, which does not resolve outside a Next
// bundle. Its error classes are re-exported verbatim from @auth/core/errors (the
// same module instance next-auth uses), so substitute that module here.
vi.mock('next-auth', () => import('@auth/core/errors'));
import { LoginRateLimited, loginErrorCode } from '../loginRateLimited';

describe('LoginRateLimited (throttled password login → "too many attempts", not "wrong password")', () => {
  it('is a CredentialsSignin (Auth.js handles it as a failed sign-in) carrying code "rate"', () => {
    const err = new LoginRateLimited();
    expect(err).toBeInstanceOf(CredentialsSignin);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('rate');
  });

  it('maps only the throttle to "rate"; a wrong password / DB lockout stays the uniform CredentialsSignin', () => {
    expect(loginErrorCode(new LoginRateLimited())).toBe('rate');
    expect(loginErrorCode(new CredentialsSignin())).toBe('CredentialsSignin');
    expect(loginErrorCode(new AuthError('other'))).toBe('CredentialsSignin');
    expect(loginErrorCode(new Error('boom'))).toBe('CredentialsSignin');
  });

  it('a plain CredentialsSignin has the default code (no account state leaks through code)', () => {
    expect(new CredentialsSignin().code).toBe('credentials');
  });
});
