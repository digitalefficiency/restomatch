import 'server-only';

/**
 * Server-only Supabase client for resolving uploaded invoice scans.
 *
 * SECURITY: invoice scans are tenant data. The bucket is private and rows are
 * resolved ONLY when their restaurant matches the caller's session, then served
 * via a short-lived signed URL (never a public URL). This uses the service-role
 * key — which bypasses RLS — so the tenant check here is explicit and mandatory.
 */

import { readLocalScanMeta, scanIdFromLocalUrl } from '@restomatch/api';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

function getServiceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
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
  /** Where the bytes live: the private Supabase bucket or the dev-only local disk. */
  source?: 'supabase' | 'local';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids minted by scans.upload (`scan-<base36>-<hex>`); nothing else is signed directly. */
const SCAN_ID = /^scan-[a-z0-9]+-[a-f0-9]+$/;
const SCAN_BUCKET = 'invoice-scans';
/** A bare object file under the tenant prefix: `scan-…` plus an extension, no sub-folders. */
const SCAN_FILE = /^scan-[a-z0-9]+-[a-f0-9]+\.[a-z0-9]{1,5}$/;
/** extFromMime() in packages/api/src/lib/supabaseStorage.ts, most common first. */
const SCAN_EXTS = ['jpg', 'pdf', 'png', 'webp'] as const;
const SIGNED_PATH = /\/storage\/v1\/object\/sign\/([^/?#]+)\/([^?#]+)/;

/** Re-sign a storage object for `restaurantId` (path must live under its prefix). */
async function signTenantPath(
  bucket: string,
  storagePath: string,
  restaurantId: string,
): Promise<ResolvedScan | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  // Tenant gate: scans.upload always writes under `<restaurantId>/`.
  if (!storagePath.startsWith(`${restaurantId}/`) || storagePath.includes('..')) return null;
  const { data: signed, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (error || !signed?.signedUrl) return null;
  const ext = storagePath.split('.').pop()?.toLowerCase();
  const mimeType =
    ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { signedUrl: signed.signedUrl, mimeType, pageCount: null, supplierName: null, source: 'supabase' };
}

/**
 * Resolve a scan by its scan id (`scan-…`, from scans.upload) OR by an invoice
 * UUID (the invoice correction page links `/scans/<invoice.id>`). The invoice
 * lookup is the caller's tenant-scoped tRPC read, so a foreign invoice is a
 * miss. Local dev scans (no Supabase) are served by `/scans/<id>/file`.
 */
export async function resolveScan(
  id: string,
  restaurantId: string | null,
  getInvoiceImageUrl: (invoiceId: string) => Promise<string | null>,
): Promise<ResolvedScan | null> {
  if (!restaurantId) return null;

  let scanId = id;
  if (UUID.test(id)) {
    const url = await getInvoiceImageUrl(id);
    if (!url) return null;
    // G-09: new rows may keep the bare storage path `<restaurantId>/<scanId>.<ext>`.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      const rest = url.startsWith(`${restaurantId}/`) ? url.slice(restaurantId.length + 1) : '';
      return SCAN_FILE.test(rest) ? signTenantPath(SCAN_BUCKET, url, restaurantId) : null;
    }
    const local = scanIdFromLocalUrl(url);
    if (local) {
      scanId = local;
    } else {
      const m = SIGNED_PATH.exec(url);
      if (!m) return null;
      return signTenantPath(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!), restaurantId);
    }
  }

  const uploaded = await resolveUploadedScan(scanId, restaurantId);
  if (uploaded) return { ...uploaded, source: 'supabase' };

  // No mapping row (it is best-effort in scans.upload): the object still lives
  // at `<restaurantId>/<scanId>.<ext>`, so sign it directly.
  if (SCAN_ID.test(scanId)) {
    for (const ext of SCAN_EXTS) {
      const direct = await signTenantPath(SCAN_BUCKET, `${restaurantId}/${scanId}.${ext}`, restaurantId);
      if (direct) return direct;
    }
  }

  const meta = await readLocalScanMeta(restaurantId, scanId);
  if (!meta) return null;
  return {
    signedUrl: `/scans/${scanId}/file`,
    mimeType: meta.mimeType,
    pageCount: null,
    supplierName: meta.supplierName,
    source: 'local',
  };
}
