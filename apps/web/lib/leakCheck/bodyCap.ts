import 'server-only';

/**
 * Raw request-body cap for the public leak-check routes (condition of the zod
 * exception GHSA-mrhx-c7xc-m3w5: no unbounded body ever reaches a parser).
 *
 * The body stream is read chunk by chunk and abandoned the moment it passes
 * `maxBytes`, whatever `content-length` claims (absent, chunked or lying), so
 * formData()/JSON parsing only ever sees at most `maxBytes`. One function so it
 * can be swapped for the shared public-route guard (apps/web/lib/publicGuard.ts)
 * without touching the handlers.
 */
export type CappedBody = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too_large' | 'unreadable' };

export async function readCappedBody(req: Request, maxBytes: number): Promise<CappedBody> {
  const declared = req.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= maxBytes)) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, bytes };
}

/** Parse multipart form data from already-capped bytes. */
export function formDataFrom(bytes: Uint8Array, contentType: string | null): Promise<FormData> {
  return new Response(new Blob([bytes as BlobPart]), { headers: { 'content-type': contentType ?? '' } }).formData();
}
