import { z } from 'zod';
import { guardSupplierPost } from '@/lib/supplierConfirm/guard';
import { supplierPortalSubmit } from '@/lib/supplierConfirm/data';

/**
 * Public supplier answer (wave-1 `supplierConfirm`). No session: the token in the
 * path is the credential. Guarded (same-origin, body cap, per-IP + per-token rate
 * limits) before anything is parsed; the order itself is never written.
 */
export const dynamic = 'force-dynamic';

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
  const guarded = await guardSupplierPost(req, token);
  if (!guarded.ok) {
    const { status, error, retryAfter } = guarded.fail;
    return json(status, { ok: false, error }, retryAfter ? { 'retry-after': String(retryAfter) } : {});
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(JSON.parse(guarded.body));
  } catch {
    return json(400, { ok: false, error: 'invalid_body' });
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
