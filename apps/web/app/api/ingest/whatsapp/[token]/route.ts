/**
 * WhatsApp Business Cloud API webhook — one URL per restaurant:
 *   /api/ingest/whatsapp/<secret token>   (flag `ingestWhatsapp`)
 *
 * GET  = Meta's subscription handshake (hub.verify_token + live channel).
 * POST = message events, verified with X-Hub-Signature-256 over the raw body.
 * Public by design (lib/publicPaths.ts); all checks live in
 * @restomatch/api handleWhatsApp* and are covered by ingest.attack.test.ts.
 */
import { handleWhatsAppVerify, handleWhatsAppWebhook, INGEST_IP_LIMIT } from '@restomatch/api';
import { INGEST_LIMITS } from '@restomatch/ingest';
import { ingestDeps } from '@/lib/ingest/webhook';
import { guardPublicRequest } from '@/lib/publicGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleWhatsAppVerify(req, token, ingestDeps(req));
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Shared front door (S4): method, streamed body cap, per-IP limit. The HMAC is
  // verified over g.rawBody in the handler; the per-channel limit runs there too.
  const g = await guardPublicRequest(req, {
    rateLimit: { ...INGEST_IP_LIMIT, prefix: 'ingest:wa:ip' },
    maxBodyBytes: INGEST_LIMITS.whatsappBodyBytes,
    bodyType: 'text',
  });
  if (!g.ok) return g.response;
  return handleWhatsAppWebhook(req, token, { ...ingestDeps(req), rawBody: g.rawBody });
}
