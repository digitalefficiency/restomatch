'use client';

/**
 * ANONYMOUS showcase receiver upload (public /showcase/receiver demo).
 *
 * SECURITY (SB-3): the browser no longer talks to Supabase Storage at all.
 * It posts the file to the same-origin, rate-limited `POST /api/showcase/upload`,
 * which validates it and uploads with the service role to the private bucket's
 * `walk-ins/` prefix, returning only a short-lived signed URL. Previously the
 * anon key wrote here directly, which needed anon INSERT/SELECT policies that
 * let anyone list and download every prospect's uploaded invoice.
 *
 * The AUTHENTICATED dashboard flow does NOT use this — it uploads through the
 * server `scans.upload` tRPC mutation (tenant + path derived from the session).
 */

export interface UploadedScan {
  /** The logical scan id. */
  invoiceId: string;
  /**
   * Short-lived SIGNED URL to the file inside Supabase Storage (the bucket is
   * private — this is NOT a public URL). Used for the immediate in-flow OCR.
   */
  publicUrl: string;
  /** Relative scans-route URL (preferred for in-app linking). */
  scanRouteUrl: string;
  /** Storage path inside the bucket (empty for the showcase — server-side detail). */
  storagePath: string;
  /** MIME type of the stored file. */
  mimeType: string;
}

/** Storage isn't configured on this deployment — the demo continues locally. */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Scan storage is not configured on this deployment');
  }
}

export type ShowcaseUploadErrorCode =
  | 'too_large'
  | 'unsupported_type'
  | 'type_mismatch'
  | 'too_many_requests'
  | 'upload_failed'
  | 'network';

/** A coded upload failure the UI translates (never raw server text). */
export class ShowcaseUploadError extends Error {
  constructor(readonly code: ShowcaseUploadErrorCode) {
    super(code);
    this.name = 'ShowcaseUploadError';
  }
}

const KNOWN: ReadonlySet<string> = new Set([
  'too_large',
  'unsupported_type',
  'type_mismatch',
  'too_many_requests',
  'upload_failed',
]);

/**
 * Upload a captured file for the anonymous showcase via the server endpoint.
 * Throws SupabaseNotConfiguredError (→ local demo mode) or ShowcaseUploadError.
 */
export async function uploadInvoiceScan(
  file: File | Blob,
  opts: { filename?: string } = {},
): Promise<UploadedScan> {
  const form = new FormData();
  form.append('file', file, opts.filename ?? (file instanceof File ? file.name : 'invoice'));

  let res: Response;
  try {
    res = await fetch('/api/showcase/upload', { method: 'POST', body: form });
  } catch {
    throw new ShowcaseUploadError('network');
  }
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    scanId?: string;
    signedUrl?: string;
    mimeType?: string;
  };
  if (res.status === 503 && body.error === 'not_configured') throw new SupabaseNotConfiguredError();
  if (!res.ok || !body.ok || !body.signedUrl || !body.scanId) {
    const code = body.error && KNOWN.has(body.error) ? body.error : res.status === 413 ? 'too_large' : 'upload_failed';
    throw new ShowcaseUploadError(code as ShowcaseUploadErrorCode);
  }
  return {
    invoiceId: body.scanId,
    publicUrl: body.signedUrl,
    scanRouteUrl: body.signedUrl,
    storagePath: '',
    mimeType: body.mimeType ?? file.type,
  };
}
