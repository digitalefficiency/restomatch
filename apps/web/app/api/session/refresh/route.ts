import { NextResponse, type NextRequest } from 'next/server';
import { safeRelativePath } from '@/lib/safeRedirect';

/**
 * Re-issue the session cookie with the CURRENT membership/role, then continue
 * to `next` (same-origin path only). Server components cannot write cookies, so
 * a session minted before the user had a membership (an invitee signing in for
 * the first time) keeps `role: null` in its cookie — and the edge role gate in
 * middleware skips null roles. Routing the post-accept redirect through this
 * handler triggers the jwt `update` path (membership re-query) so the very next
 * page is role-gated at the edge too. Reads only the caller's own membership.
 *
 * `@/auth` is imported lazily: a static route module is evaluated at build time
 * ("collecting page data"), and the auth DB connection throws without
 * DATABASE_URL — which the Vercel build environment does not have.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const next = safeRelativePath(req.nextUrl.searchParams.get('next'));
  const { auth, unstable_update } = await import('@/auth');
  const session = await auth();
  if (session?.user?.id) await unstable_update({});
  const url = req.nextUrl.clone();
  const target = new URL(next, url.origin);
  url.pathname = target.pathname;
  url.search = target.search;
  return NextResponse.redirect(url);
}
