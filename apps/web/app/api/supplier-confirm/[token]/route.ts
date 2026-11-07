import { z } from 'zod';
import { hashSupplierToken } from '@restomatch/api';
import { guardPublicRequest } from '@/lib/publicGuard';
import { SUPPLIER_BODY_MAX_BYTES } from '@/lib/supplierConfirm/guard';
import { supplierPortalSubmit, supplierPortalView } from '@/lib/supplierConfirm/data';

/**
 * Public supplier answer (wave-1 `supplierConfirm`). No session: the token in the
 * path is the credential. Guarded (same-origin, body cap, per-IP + per-token rate
 * limits) before anything is parsed; the order itself is never written.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Per (IP, link) — the token's hash, never the raw token, keys the limiter. */
const LIMIT = { limit: 10, windowSec: 600, prefix: 'rl:supplier-confirm' };

const Body = z
  .object({
    intent: z.enum(['as_ordered', 'with_changes']),
    /** The `linesVersion` of the form the supplier answered (a changed order → 409 order_changed). */
    linesVersion: z.string().min(1).max(64),
    lines: z
      .array(
        z
          .object({
            poLineId: z.string().uuid(),
            // A required key (G-10 §5.1): every line states its quantity, or null = as ordered.
            qtyAvailable: z.number().finite().nullable(),
            proposedUnitPrice: z.number().finite().nullable().optional(),
          })
          .strict(),
      )
      .max(500),
    note: z.string().max(1000).nullable().optional(),
  })
  .strict();

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const g = await guardPublicRequest(req, {
    rateLimit: LIMIT,
    maxBodyBytes: SUPPLIER_BODY_MAX_BYTES,
    schema: Body,
    sameOrigin: true,
    key: (ip) => `${ip}:${hashSupplierToken(token)}`,
  });
  if (!g.ok) return g.response;
  // The service is the authority on the answer contract (G-10): every line once,
  // an explicit intent that agrees with the lines. The route only maps codes.
  const res = await supplierPortalSubmit(token, g.data);
  if (res.ok) return json(200, { ok: true, status: res.status });
  switch (res.error) {
    case 'NOT_FOUND':
      return json(404, { ok: false, error: 'not_found' });
    case 'EXPIRED':
    case 'ORDER_NOT_OPEN':
      return json(410, { ok: false, error: 'expired' });
    case 'ORDER_CLOSED':
      return json(410, { ok: false, error: 'order_closed' });
    case 'ORDER_CHANGED':
      return json(409, { ok: false, error: 'order_changed' });
    case 'INCOMPLETE_ANSWER':
      return json(422, { ok: false, error: 'incomplete_answer' });
    case 'INTENT_MISMATCH':
      return json(422, { ok: false, error: 'intent_mismatch' });
    case 'ALREADY_ANSWERED': {
      // The answer ON RECORD (read back from the DB, never echoed from this
      // request), so the client can tell its own landed retry from someone else's.
      const view = await supplierPortalView(token);
      const r = view.ok ? view.view.response : null;
      return json(409, {
        ok: false,
        error: 'already_answered',
        recorded: r ? { status: r.status, submittedAt: r.submittedAt.toISOString(), lines: r.lines, note: r.note } : null,
      });
    }
    default:
      return json(400, { ok: false, error: 'invalid_lines' });
  }
}
