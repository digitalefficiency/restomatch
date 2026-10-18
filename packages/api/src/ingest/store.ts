import { localScanStorageEnabled, localScanUrl, saveLocalScan } from '../lib/localScanStorage';
import { extFromMime, getServiceStorageClient } from '../lib/supabaseStorage';
import { deterministicScanId } from '../routers/scans';

const BUCKET = 'invoice-scans';
const SIGNED_URL_TTL_SEC = 60 * 30;

/**
 * Store an ingested document exactly where an authenticated upload goes: the
 * private `invoice-scans` bucket under `<restaurantId>/` (local disk in dev).
 * The scan id is derived from (restaurant, sha256), so a re-sent file maps to
 * the same object and registerIngestedDocument dedupes on it.
 */
export async function storeIngestedFile(args: {
  restaurantId: string;
  sha256: string;
  mimeType: string;
  bytes: Uint8Array;
  supplierName?: string | null;
}): Promise<{ scanId: string; storagePath: string }> {
  const scanId = deterministicScanId(args.restaurantId, `ingest:${args.sha256}`);
  const ext = extFromMime(args.mimeType);
  const storagePath = `${args.restaurantId}/${scanId}.${ext}`;

  const storage = getServiceStorageClient();
  if (!storage) {
    if (!localScanStorageEnabled()) throw new Error('storage not configured');
    await saveLocalScan({
      restaurantId: args.restaurantId,
      scanId,
      ext,
      mimeType: args.mimeType,
      bytes: Buffer.from(args.bytes),
      supplierName: args.supplierName ?? null,
    });
    return { scanId, storagePath };
  }
  const { error } = await storage.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(args.bytes), { contentType: args.mimeType, upsert: false });
  if (error && !/exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) {
    throw new Error(`upload failed: ${error.message}`);
  }
  return { scanId, storagePath };
}

/** A short-lived URL the OCR worker can fetch (signed bucket URL / local route). */
export async function signedUrlForStoragePath(restaurantId: string, storagePath: string): Promise<string | null> {
  // The path must stay under the tenant prefix — never sign another tenant's object.
  if (!storagePath.startsWith(`${restaurantId}/`) || storagePath.includes('..')) return null;
  const storage = getServiceStorageClient();
  if (!storage) {
    if (!localScanStorageEnabled()) return null;
    const scanId = storagePath.slice(restaurantId.length + 1).replace(/\.[a-z0-9]+$/i, '');
    return localScanUrl(scanId);
  }
  const { data } = await storage.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  return data?.signedUrl ?? null;
}
