/**
 * Public showcase (/showcase/receiver) invoice upload — SERVER side (SB-3).
 *
 * Before: the anonymous browser uploaded straight to `invoice-scans/walk-ins/`
 * with the publishable (anon) key, which required anon INSERT + SELECT storage
 * policies on that prefix — and the SELECT policy let anyone list and download
 * every walk-in upload. Prospects upload REAL supplier invoices there.
 *
 * Now the browser posts the file to a rate-limited, same-origin endpoint
 * (`POST /api/showcase/upload`) which uploads with the service role and
 * returns a short-lived signed URL. The browser never touches storage, so the
 * walk-ins anon policies can be dropped (S1's migration).
 *
 * Validation here is defense in depth: mime allowlist, size cap, and a
 * magic-byte sniff so the declared type matches the bytes.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extFromMime } from './supabaseStorage';

export const SHOWCASE_BUCKET = 'invoice-scans';
export const SHOWCASE_PREFIX = 'walk-ins';
/** Fits under Vercel's 4.5 MB request body limit with multipart overhead. */
export const SHOWCASE_MAX_BYTES = 4 * 1024 * 1024;
/** Long enough for the demo's OCR + the confirm screen's "view scan" link. */
export const SHOWCASE_SIGNED_URL_TTL_SEC = 10 * 60;

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45,
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
};

export type ShowcaseUploadError = 'unsupported_type' | 'too_large' | 'empty' | 'type_mismatch' | 'upload_failed';

export type ShowcaseUploadResult =
  | { ok: true; scanId: string; storagePath: string; signedUrl: string; mimeType: string }
  | { ok: false; error: ShowcaseUploadError; status: number };

export function validateShowcaseFile(
  bytes: Uint8Array,
  mimeType: string,
): { ok: true } | { ok: false; error: ShowcaseUploadError; status: number } {
  const sniff = MAGIC[mimeType];
  if (!sniff) return { ok: false, error: 'unsupported_type', status: 415 };
  if (bytes.byteLength === 0) return { ok: false, error: 'empty', status: 400 };
  if (bytes.byteLength > SHOWCASE_MAX_BYTES) return { ok: false, error: 'too_large', status: 413 };
  if (!sniff(bytes)) return { ok: false, error: 'type_mismatch', status: 415 };
  return { ok: true };
}

/** Upload with the service role under walk-ins/<yyyy-mm-dd>/ and sign it. */
export async function uploadShowcaseScan(
  storage: Pick<SupabaseClient, 'storage'>,
  bytes: Uint8Array,
  mimeType: string,
  now: Date = new Date(),
): Promise<ShowcaseUploadResult> {
  const valid = validateShowcaseFile(bytes, mimeType);
  if (!valid.ok) return valid;

  const scanId = `walk-${now.getTime().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const day = now.toISOString().slice(0, 10);
  const storagePath = `${SHOWCASE_PREFIX}/${day}/${scanId}.${extFromMime(mimeType)}`;

  const bucket = storage.storage.from(SHOWCASE_BUCKET);
  const { error: uploadError } = await bucket.upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) return { ok: false, error: 'upload_failed', status: 502 };

  const { data: signed, error: signError } = await bucket.createSignedUrl(
    storagePath,
    SHOWCASE_SIGNED_URL_TTL_SEC,
  );
  if (signError || !signed?.signedUrl) {
    await bucket.remove([storagePath]).catch(() => {});
    return { ok: false, error: 'upload_failed', status: 502 };
  }
  return { ok: true, scanId, storagePath, signedUrl: signed.signedUrl, mimeType };
}

/**
 * Is `url` a signed URL for one of the showcase's own walk-in uploads? The
 * public OCR endpoint accepts ONLY these — never a tenant scan, even with a
 * valid signed URL — and rejects dot segments (also percent-encoded) because
 * fetch() would normalize `walk-ins/../<tenant>/…` onto a tenant path.
 */
export function isShowcaseScanUrl(url: string, supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/sign/${SHOWCASE_BUCKET}/${SHOWCASE_PREFIX}/`;
  if (!url.startsWith(prefix)) return false;
  const path = url.slice(prefix.length).split(/[?#]/)[0] ?? '';
  if (path === '') return false;
  if (/%2f|%5c|\\/i.test(path)) return false;
  return !path.split('/').some((seg) => /^(\.|%2e){1,2}$/i.test(seg));
}
