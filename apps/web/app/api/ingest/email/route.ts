/**
 * Inbound e-mail webhook (Resend `email.received`, Svix/Standard-Webhooks
 * signed; the Postmark inbound JSON shape is accepted too). The restaurant is
 * found from the secret token in the recipient address
 * (`inv_<token>@<INGEST_EMAIL_DOMAIN>`) — flag `ingestEmail`.
 * Public by design (lib/publicPaths.ts); checks in @restomatch/api
 * handleEmailWebhook, covered by ingest.attack.test.ts.
 */
import { handleEmailWebhook, INGEST_IP_LIMIT } from '@restomatch/api';
import { INGEST_LIMITS } from '@restomatch/ingest';
import { ingestDeps } from '@/lib/ingest/webhook';
import { withKickBudget } from '@/lib/jobKick';
import { guardPublicRequest } from '@/lib/publicGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  // The OCR jobs this enqueues are kicked after the response only while a whole
  // job still fits in maxDuration (lib/jobKick.ts); otherwise /api/cron/jobs runs them.
  return withKickBudget(maxDuration, async () => {
    // Shared front door (S4): method, streamed body cap, per-IP limit; the
    // Svix/Standard-Webhooks signature is verified over g.rawBody in the handler.
    const g = await guardPublicRequest(req, {
      rateLimit: { ...INGEST_IP_LIMIT, prefix: 'ingest:email:ip' },
      maxBodyBytes: INGEST_LIMITS.emailBodyBytes,
      bodyType: 'text',
    });
    if (!g.ok) return g.response;
    return handleEmailWebhook(req, { ...ingestDeps(req), rawBody: g.rawBody });
  });
}
