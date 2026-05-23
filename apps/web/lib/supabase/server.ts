/**
 * Server-only Supabase client used by the /scans/[invoiceId] page route
 * to look up whether the receiver has uploaded an actual scanned document
 * for this invoice. Falls back gracefully when env vars aren't set so the
 * showcase keeps working without a live Supabase project.
 *
 * The publishable (anon) key is fine to read with — the invoice_scans
 * table has RLS allowing public SELECT, and the invoice-scans bucket is
 * marked public so files are reachable at
 *   {SUPABASE_URL}/storage/v1/object/public/invoice-scans/{path}
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
    global: { fetch: (...args) => fetch(...args) },
  });
  return cached;
}

export interface ResolvedScan {
  /** Public URL to embed in <iframe> or <img>. */
  publicUrl: string;
  mimeType: string;
  pageCount: number | null;
  supplierName: string | null;
}

/**
 * Look up the real uploaded scan for a given invoice id. Returns null when
 * Supabase isn't configured, the row doesn't exist, or the file can't be
 * resolved — callers should fall back to the mock <InvoicePaper> renderer.
 */
export async function resolveUploadedScan(invoiceId: string): Promise<ResolvedScan | null> {
  const supabase = getClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('invoice_scans')
    .select('bucket, storage_path, mime_type, page_count, supplier_name')
    .eq('invoice_id', invoiceId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: publicUrlData } = supabase.storage
    .from(data.bucket as string)
    .getPublicUrl(data.storage_path as string);

  if (!publicUrlData?.publicUrl) return null;

  return {
    publicUrl: publicUrlData.publicUrl,
    mimeType: (data.mime_type as string) ?? 'application/pdf',
    pageCount: (data.page_count as number | null) ?? null,
    supplierName: (data.supplier_name as string | null) ?? null,
  };
}
