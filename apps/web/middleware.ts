import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from './auth.config';

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
    path.startsWith('/api/auth') ||
    path.startsWith('/_next') ||
    looksLikeAsset;

  if (!req.auth && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
