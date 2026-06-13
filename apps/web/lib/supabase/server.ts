import 'server-only';

/**
 * Server-only Supabase client for resolving uploaded invoice scans.
 *
 * SECURITY: invoice scans are tenant data. The bucket is private and rows are
 * resolved ONLY when their restaurant matches the caller's session, then served
 * via a short-lived signed URL (never a public URL). This uses the service-role
 * key — which bypasses RLS — so the tenant check here is explicit and mandatory.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

function getServiceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export interface ResolvedScan {
  /** Short-lived signed URL to embed in <iframe> or <img>. */
  signedUrl: string;
  mimeType: string;
  pageCount: number | null;
  supplierName: string | null;
}

const SIGNED_URL_TTL_SEC = 60 * 30; // 30 minutes

/**
 * Resolve the uploaded scan for `invoiceId`, but ONLY if it belongs to
 * `restaurantId`. Returns null when Supabase isn't configured, the row doesn't
 * exist, the row belongs to another tenant, or the file can't be signed.
 *
 * `restaurantId` must come from the authenticated session — never from the URL.
 */
export async function resolveUploadedScan(
  invoiceId: string,
  restaurantId: string | null,
): Promise<ResolvedScan | null> {
  if (!restaurantId) return null;
  const supabase = getServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('invoice_scans')
    .select('bucket, storage_path, mime_type, page_count, supplier_name, restaurant_id')
    .eq('invoice_id', invoiceId)
    .eq('restaurant_id', restaurantId) // tenant gate — service role bypasses RLS
    .maybeSingle();

  if (error || !data) return null;

  const { data: signed, error: signError } = await supabase.storage
    .from(data.bucket as string)
    .createSignedUrl(data.storage_path as string, SIGNED_URL_TTL_SEC);

  if (signError || !signed?.signedUrl) return null;

  return {
    signedUrl: signed.signedUrl,
    mimeType: (data.mime_type as string) ?? 'application/pdf',
    pageCount: (data.page_count as number | null) ?? null,
    supplierName: (data.supplier_name as string | null) ?? null,
  };
}
