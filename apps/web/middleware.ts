import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from './auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isPublic =
    req.nextUrl.pathname === '/' ||
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/showcase') ||
    req.nextUrl.pathname.startsWith('/scans') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/_next') ||
    req.nextUrl.pathname.includes('.');

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
