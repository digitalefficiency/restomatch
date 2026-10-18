/**
 * Serves a LOCAL (development-only) invoice scan's bytes. Production scans live
 * in the private Supabase bucket and are served as short-lived signed URLs; this
 * route only answers when local scan storage is enabled (never in production —
 * see packages/api/src/lib/localScanStorage.ts) and only for the caller's own
 * restaurant (the directory is derived from the session, never the URL).
 */
import { readLocalScan } from '@restomatch/api';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const { invoiceId } = await params;
  const session = await auth();
  const restaurantId = session?.user?.restaurantId ?? null;
  // A 2FA-pending session holds only the first factor — never serve tenant files
  // to it (middleware also redirects it; this route must not depend on that).
  if (!session?.user?.id || session.user.twoFactorPending || !restaurantId) {
    return new Response('Not found', { status: 404 });
  }

  const scan = await readLocalScan(restaurantId, invoiceId);
  if (!scan) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(scan.bytes), {
    status: 200,
    headers: {
      'content-type': scan.meta.mimeType,
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
