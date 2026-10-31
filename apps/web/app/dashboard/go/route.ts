import { NextResponse, type NextRequest } from 'next/server';
import { resolveGo } from '@/lib/net/goResolver';

/**
 * Branch-aware deep-link resolver: `/dashboard/go?r=<restaurantId>&to=<path>`
 * (W1-04; see lib/net/goResolver.ts). Re-checks membership, switches the
 * session's branch, validates `to`, then 303s. A non-member `r` lands on the
 * in-shell forbidden page — the session is left untouched.
 *
 * `@/auth` and the tRPC caller are imported lazily: a static route module is
 * evaluated at build time, and the auth DB connection throws without
 * DATABASE_URL (same reason as /api/session/refresh).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { auth, unstable_update } = await import('@/auth');
  const session = await auth();
  const params = req.nextUrl.searchParams;
  if (!session?.user?.id) {
    const login = new URL('/login', req.nextUrl.origin);
    login.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(login, 303);
  }
  const { createServerCaller } = await import('@/lib/trpc/server');
  const result = await resolveGo(
    { r: params.get('r'), to: params.get('to'), activeRestaurantId: session.user.restaurantId ?? null },
    {
      checkMembership: async (restaurantId) => (await createServerCaller()).chain.switchTarget({ restaurantId }),
      switchTo: (restaurantId) =>
        unstable_update({ activeRestaurantId: restaurantId } as unknown as Parameters<typeof unstable_update>[0]),
    },
  );
  return NextResponse.redirect(new URL(result.location, req.nextUrl.origin), 303);
}
