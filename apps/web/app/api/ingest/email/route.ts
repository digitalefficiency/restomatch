/**
 * Inbound e-mail webhook (Resend `email.received`, Svix/Standard-Webhooks
 * signed; the Postmark inbound JSON shape is accepted too). The restaurant is
 * found from the secret token in the recipient address
 * (`inv_<token>@<INGEST_EMAIL_DOMAIN>`) — flag `ingestEmail`.
 * Public by design (lib/publicPaths.ts); checks in @restomatch/api
 * handleEmailWebhook, covered by ingest.attack.test.ts.
 */
import { handleEmailWebhook } from '@restomatch/api';
import { ingestDeps } from '@/lib/ingest/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleEmailWebhook(req, ingestDeps(req));
}
