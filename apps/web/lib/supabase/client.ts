'use client';

/**
 * Browser Supabase client + helper that uploads a captured invoice file
 * from the receiver wizard into the invoice-scans bucket, then writes
 * a mapping row in public.invoice_scans so /scans/[invoiceId] resolves
 * to the real document.
 *
 * Anon-only flow: the showcase has no auth on the receiver wizard, so
 * uploads use the publishable key and are constrained by RLS to the
 * walk-ins/ prefix only.
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
  /** Direct public URL to the file inside Supabase Storage. */
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

/**
 * Upload a file picked / captured in the receiver wizard. Returns the
 * generated invoice id and the resolved public URL. Throws if Supabase
 * isn't configured or the upload fails.
 */
export async function uploadInvoiceScan(
  file: File,
  opts: { supplierName?: string } = {},
): Promise<UploadedScan> {
  const supabase = getClient();
  if (!supabase) throw new SupabaseNotConfiguredError();

  // Generate a stable id for the rest of the wizard / scans route.
  const invoiceId = `walk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = guessExtension(file);
  const storagePath = `walk-ins/${invoiceId}.${ext}`;

  // 1. Upload bytes to the bucket
  const { error: uploadError } = await supabase.storage
    .from('invoice-scans')
    .upload(storagePath, file, {
      contentType: file.type || guessMime(ext),
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  // 2. Resolve the public URL
  const { data: publicUrlData } = supabase.storage
    .from('invoice-scans')
    .getPublicUrl(storagePath);
  if (!publicUrlData?.publicUrl) {
    throw new Error('Could not resolve public URL after upload');
  }

  // 3. Insert a mapping row so /scans/[id] knows where to look
  const { error: insertError } = await supabase.from('invoice_scans').insert({
    invoice_id: invoiceId,
    bucket: 'invoice-scans',
    storage_path: storagePath,
    mime_type: file.type || guessMime(ext),
    supplier_name: opts.supplierName ?? null,
    page_count: null,
  });
  if (insertError) {
    // Best-effort cleanup of the just-uploaded file
    await supabase.storage.from('invoice-scans').remove([storagePath]).catch(() => {});
    throw new Error(`Supabase mapping insert failed: ${insertError.message}`);
  }

  return {
    invoiceId,
    publicUrl: publicUrlData.publicUrl,
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
