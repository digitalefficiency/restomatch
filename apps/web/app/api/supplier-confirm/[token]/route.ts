import { z } from 'zod';
import { hashSupplierToken } from '@restomatch/api';
import { guardPublicRequest } from '@/lib/publicGuard';
import { SUPPLIER_BODY_MAX_BYTES } from '@/lib/supplierConfirm/guard';
import { supplierPortalSubmit, supplierPortalView } from '@/lib/supplierConfirm/data';
import { incompleteAnswer } from './completeness';

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
    lines: z
      .array(
        z
          .object({
            poLineId: z.string().uuid(),
            qtyAvailable: z.number().finite().nullable().optional(),
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
  const parsed = g.data;
  // A line-by-line answer must speak to EVERY line of the order with an
  // explicit quantity (0 = out of stock): a partial list would silently read as
  // "as ordered" for the lines it left out. `lines: []` stays the explicit
  // "confirm as ordered" (the note, if any, is still carried).
  if (parsed.lines.length > 0) {
    const view = await supplierPortalView(token);
    if (!view.ok) return view.error === 'EXPIRED' ? json(410, { ok: false, error: 'expired' }) : json(404, { ok: false, error: 'not_found' });
    const missing = incompleteAnswer(view.view.lines.map((l) => l.id), parsed.lines);
    if (missing) return json(400, { ok: false, error: missing });
  }
  const res = await supplierPortalSubmit(token, parsed);
  if (res.ok) return json(200, { ok: true, status: res.status });
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
