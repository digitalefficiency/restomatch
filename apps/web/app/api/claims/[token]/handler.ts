import { z } from 'zod';
import { claimPortal } from '@restomatch/api';
import { guardPublicRequest, publicClientIp } from '@/lib/publicGuard';
import { enforceRateLimit } from '@/lib/rateLimit';

/**
 * H-06ʰ — POST /api/claims/<token>: the supplier answers a "מכתב בקשת זיכוי".
 * No session: the signed token in the path is the credential.
 *
 * Order (everything before any DB read):
 *   1. guardPublicRequest — POST only, same-origin, 16 KiB streamed cap, strict
 *      zod (unknown fields ⇒ 422), and the per-(IP × token-hash) limiter;
 *   2. a per-IP limiter across ALL links, so rotating tokens can't spray guesses;
 *   3. resolve + submit in the link's tenant transaction.
 * The raw token never keys a limiter and is never logged or echoed.
 */
export const CLAIM_BODY_MAX_BYTES = 16 * 1024;
/** Per (IP, link): a supplier answers once or twice; 10 tries per 10 min is generous. */
export const CLAIM_TOKEN_LIMIT = { limit: 10, windowSec: 600, prefix: 'rl:claim-portal' };
/** Per IP across every link. */
export const CLAIM_IP_LIMIT = { limit: 30, windowSec: 600, prefix: 'rl:claim-portal-ip' };

export const ClaimAnswerBody = z
  .object({
    lines: z
      .array(
        z
          .object({
            claimId: z.string().uuid(),
            answer: z.enum(['agree', 'check']),
            note: z.string().max(claimPortal.MAX_NOTE_CHARS).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(claimPortal.MAX_LETTER_LINES),
    creditNoteNumber: z.string().max(claimPortal.MAX_CREDIT_NOTE_NUMBER_CHARS).nullable().optional(),
    note: z.string().max(claimPortal.MAX_NOTE_CHARS).nullable().optional(),
  })
  .strict();

export type ClaimSubmit = (
  token: string,
  input: claimPortal.ClaimAnswerInput,
) => Promise<claimPortal.ClaimAnswerResult | { ok: false; error: claimPortal.ClaimLinkError }>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers },
  });

export async function handleClaimAnswer(req: Request, token: string, submit: ClaimSubmit): Promise<Response> {
  const tokenHash = claimPortal.hashClaimToken(String(token));
  const g = await guardPublicRequest(req, {
    rateLimit: CLAIM_TOKEN_LIMIT,
    maxBodyBytes: CLAIM_BODY_MAX_BYTES,
    schema: ClaimAnswerBody,
    sameOrigin: true,
    key: (ip) => `${ip}:${tokenHash}`,
  });
  if (!g.ok) return g.response;

  const perIp = await enforceRateLimit(publicClientIp(req.headers), CLAIM_IP_LIMIT);
  if (!perIp.allowed) {
    return json(429, { ok: false, error: 'too many requests' }, { 'retry-after': String(Math.max(1, perIp.resetSec)) });
  }

  const res = await submit(token, g.data);
  if (res.ok) return json(200, { ok: true, acknowledged: res.acknowledged, checking: res.checking });
  switch (res.error) {
    case 'NOT_FOUND':
      return json(404, { ok: false, error: 'not_found' });
    case 'EXPIRED':
      return json(410, { ok: false, error: 'expired' });
    case 'ALREADY_ANSWERED':
      return json(409, { ok: false, error: 'already_answered' });
    default:
      return json(400, { ok: false, error: 'invalid_lines' });
  }
}
