/**
 * WhatsApp Business Cloud API webhook — one URL per restaurant:
 *   /api/ingest/whatsapp/<secret token>   (flag `ingestWhatsapp`)
 *
 * GET  = Meta's subscription handshake (hub.verify_token + live channel).
 * POST = message events, verified with X-Hub-Signature-256 over the raw body.
 * Public by design (lib/publicPaths.ts); all checks live in
 * @restomatch/api handleWhatsApp* and are covered by ingest.attack.test.ts.
 */
import { handleWhatsAppVerify, handleWhatsAppWebhook } from '@restomatch/api';
import { ingestDeps } from '@/lib/ingest/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleWhatsAppVerify(req, token, ingestDeps(req));
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleWhatsAppWebhook(req, token, ingestDeps(req));
}
