'use client';

/**
 * Browser Supabase client for the ANONYMOUS showcase receiver only.
 *
 * SECURITY (PR1 / A.1 + A.3):
 *  - The bucket is PRIVATE. We never call getPublicUrl(); reads are served as
 *    short-lived signed URLs (here for the showcase, and server-side for the
 *    authenticated /scans/[invoiceId] viewer).
 *  - The AUTHENTICATED dashboard upload does NOT go through here anymore — it
 *    goes through the server `scans.upload` tRPC mutation, which derives the
 *    tenant + path from the session (see ReceivingWizard). The browser can no
 *    longer choose a restaurant id or a storage prefix.
 *  - The anonymous showcase stays constrained by storage RLS to the shared
 *    `walk-ins/` prefix and writes NO invoice_scans mapping row (those rows are
 *    now strictly tenant-scoped — restaurant_id is NOT NULL).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export interface UploadedScan {
  /** The logical invoice id (used as /scans/[invoiceId]). */
  invoiceId: string;
  /**
   * Short-lived SIGNED URL to the file inside Supabase Storage (the bucket is
   * private — this is NOT a public URL). Used for the immediate in-flow OCR.
   */
  publicUrl: string;
  /** Relative scans-route URL (preferred for in-app linking). */
  scanRouteUrl: string;
  /** Storage path inside the bucket. */
  storagePath: string;
  /** MIME type detected from the upload. */
  mimeType: string;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase env vars missing — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
}

const SIGNED_URL_TTL_SEC = 60 * 30; // 30 minutes — enough for the showcase OCR.

/**
 * ANONYMOUS showcase upload only. Uploads a captured file to the shared
 * `walk-ins/` prefix (storage RLS-constrained) and returns a short-lived SIGNED
 * URL for the demo OCR/preview. Writes NO invoice_scans mapping row — those are
 * strictly tenant-scoped now. Throws if Supabase isn't configured or upload
 * fails.
 *
 * The AUTHENTICATED dashboard flow must NOT use this — it uploads via the
 * server `scans.upload` mutation (tenant + path derived from the session).
 */
export async function uploadInvoiceScan(
  file: File,
  opts: { supplierName?: string } = {},
): Promise<UploadedScan> {
  void opts.supplierName; // (no longer persisted on the anon path)
  const supabase = getClient();
  if (!supabase) throw new SupabaseNotConfiguredError();

  // Generate a stable id for the rest of the wizard / scans route.
  const invoiceId = `walk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = guessExtension(file);
  const storagePath = `walk-ins/${invoiceId}.${ext}`;

  // 1. Upload bytes to the (private) bucket — RLS allows anon under walk-ins/.
  const { error: uploadError } = await supabase.storage
    .from('invoice-scans')
    .upload(storagePath, file, {
      contentType: file.type || guessMime(ext),
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  // 2. Sign a short-lived URL (private bucket — never getPublicUrl()).
  const { data: signed, error: signError } = await supabase.storage
    .from('invoice-scans')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (signError || !signed?.signedUrl) {
    await supabase.storage.from('invoice-scans').remove([storagePath]).catch(() => {});
    throw new Error(`Could not sign URL after upload: ${signError?.message ?? 'unknown'}`);
  }

  return {
    invoiceId,
    publicUrl: signed.signedUrl,
    scanRouteUrl: `/scans/${invoiceId}`,
    storagePath,
    mimeType: file.type || guessMime(ext),
  };
}

function guessExtension(file: File): string {
  const fromType: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const mapped = fromType[file.type];
  if (mapped) return mapped;
  const m = file.name.match(/\.([a-zA-Z0-9]+)$/);
  return (m?.[1] ?? 'jpg').toLowerCase();
}

function guessMime(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[ext] ?? 'application/octet-stream';
}
