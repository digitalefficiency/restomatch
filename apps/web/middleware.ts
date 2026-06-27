import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { UserRole } from '@restomatch/db';
import { authConfig } from './auth.config';
import { allowedRolesForPath } from './lib/roles';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  // NOTE: /scans is intentionally NOT public — invoice documents are tenant
  // data. The page itself re-checks the session and tenant ownership; keeping
  // it out of this list means unauthenticated requests redirect to login.
  const path = req.nextUrl.pathname;
  // Only the LAST path segment having a file extension marks a static asset —
  // a dot anywhere in the path (e.g. a dynamic /scans/<id-with-dot>) must not
  // make a dynamic route accidentally public.
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const looksLikeAsset = /\.[a-z0-9]+$/i.test(lastSegment);
  const isPublic =
    // Marketing landing pages — anonymous visitors can view these. /scans and
    // /admin are intentionally absent so they keep redirecting to login.
    path === '/' ||
    path === '/pricing' ||
    path === '/about' ||
    path.startsWith('/login') ||
    path.startsWith('/showcase') ||
    path.startsWith('/api/showcase') ||
    path.startsWith('/api/auth') ||
    path.startsWith('/_next') ||
    looksLikeAsset;

  // Treat a token with no user id as unauthenticated. The AUTHORITATIVE
  // per-request revocation gate is the NODE jwt callback in auth.ts: it re-reads
  // token_version on EVERY request (B.2) and, on a mismatch / elapsed remember-me
  // window, re-issues an EMPTY token. The edge can't do a DB read, so it does NOT
  // independently validate token_version here — it only HONOURS the emptied token
  // the node callback produces (req.auth truthy but no user id) as best-effort
  // defence-in-depth. Every protected surface (dashboard RSC, tRPC route, server
  // actions) calls node auth(), so the node callback is the real gate; this edge
  // check is a backstop, not a substitute for it.
  const sessionUser = req.auth?.user as
    | { id?: string; twoFactorPending?: boolean }
    | undefined;
  const isAuthed = Boolean(req.auth) && Boolean(sessionUser?.id);
  if (!isAuthed && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // 2FA session gate (Epic C): once a user is 2FA-enrolled, the FIRST factor
  // (password OR magic-link) leaves the session pending until the TOTP step.
  // A pending session may only reach /login (incl. /login/2fa); everything else
  // bounces to the second-factor screen. Inert for users without 2FA enrolled.
  if (isAuthed && sessionUser?.twoFactorPending && !path.startsWith('/login')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login/2fa';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Server-side role gate: a signed-in member hitting a dashboard route their
  // role can't see is bounced to the overview. The nav hides these links and the
  // tRPC procedures enforce data access — this also blocks direct-URL access.
  // (Role can be briefly stale within the JWT revalidation window; acceptable.)
  const role = (req.auth?.user as { role?: UserRole | null } | undefined)?.role ?? null;
  if (req.auth && role && path.startsWith('/dashboard')) {
    const allowed = allowedRolesForPath(path);
    if (allowed && !allowed.includes(role)) {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
