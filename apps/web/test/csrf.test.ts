import { Auth } from '@auth/core';
import Credentials from '@auth/core/providers/credentials';
import { describe, expect, it, vi } from 'vitest';

/**
 * CSRF negative test (B.6).
 *
 * A cross-origin POST to the credentials callback WITHOUT a valid CSRF
 * double-submit cookie must NOT reach authorize() and must NOT establish a
 * session. next-auth wraps @auth/core, so exercising @auth/core's Auth() with
 * the same shape we use in auth.ts (jwt strategy + a Credentials provider +
 * trustHost) faithfully proves the protection — without dragging the Next
 * runtime into the unit test. The login page drives sign-in through the
 * signIn() server action precisely so this guard is never bypassed by a
 * hand-rolled fetch to the callback.
 */

function sessionCookieValue(res: Response): string | undefined {
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie
    ? getSetCookie.call(res.headers)
    : [res.headers.get('set-cookie') ?? ''];
  for (const c of cookies) {
    const m = /^([^=]*session-token)=([^;]*)/.exec(c.trim());
    if (m) return m[2];
  }
  return undefined;
}

describe('credentials callback rejects forged cross-origin POSTs (B.6)', () => {
  it('a cross-origin POST with no matching CSRF cookie never reaches authorize()', async () => {
    const authorize = vi.fn(async () => ({ id: 'should-never-be-reached' }));
    const config = {
      secret: 'test-only-secret-not-production-0123456789',
      trustHost: true,
      basePath: '/api/auth',
      session: { strategy: 'jwt' as const },
      providers: [
        Credentials({
          credentials: { email: {}, password: {} },
          authorize,
        }),
      ],
    };

    const req = new Request('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'localhost:3000',
        origin: 'https://evil.example',
      },
      body: new URLSearchParams({
        email: 'victim@restaurant.example',
        password: 'irrelevant',
        csrfToken: 'forged-token-with-no-matching-cookie',
      }).toString(),
    });

    const res = await Auth(req, config);

    // The forged request is rejected BEFORE credential verification…
    expect(authorize).not.toHaveBeenCalled();
    // …and no live session token is issued.
    const token = sessionCookieValue(res);
    expect(token === undefined || token === '').toBe(true);
    // Auth.js answers an auth error (302 to the error page), never a 200 sign-in.
    expect(res.status).not.toBe(200);
  });
});
