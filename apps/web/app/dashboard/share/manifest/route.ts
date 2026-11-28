import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enabledFeatures } from '@/lib/ingest/features';
import { manifestFor } from '@/lib/pwa/manifest';

/**
 * W3-03b · the app manifest for the signed-in viewer: the static base plus only
 * the shortcuts this role (and the restaurant's flags) can open. Linked with
 * `crossorigin="use-credentials"` so the session cookie comes along. Reads no
 * tenant data beyond the viewer's own role and flags; private, never cached.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const role = session?.user?.role ?? null;
  const features = role ? await enabledFeatures(session?.user?.restaurantId) : [];
  return new NextResponse(JSON.stringify(manifestFor(role ? { role, features } : null)), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'private, no-store',
      vary: 'cookie',
    },
  });
}
