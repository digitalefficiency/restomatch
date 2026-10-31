import { localScanStorageEnabled, localScanUrl, scanIdFromLocalUrl } from '../lib/localScanStorage';
import { allowedScanUrlPrefix, INVOICE_SCANS_BUCKET, isAllowedScanUrl } from '../lib/scanUrls';
import { signedUrlForStoragePath } from '../ingest/store';

/**
 * Object refs: the ONE way to name a stored scan.
 *
 * A ref is the tenant storage path `<restaurantId>/<scanId>[.<ext>]`. Legacy rows
 * keep a 30-minute signed URL in `invoices.raw_image_url`; new rows keep a
 * stable form (see `storedImageValue`). `toObjectRef` maps every form to the
 * same ref, so the dedupe key is the object, never a URL that expires.
 */

const SCAN_FILE = /^scan-[a-z0-9]+-[a-f0-9]+(?:\.[a-z0-9]{1,5})?$/;
const SIGNED_OBJECT = new RegExp(`/storage/v1/object/(?:sign|public|authenticated)/${INVOICE_SCANS_BUCKET}/([^?#]+)`);

/**
 * G-09 §5.2: new rows store the bare tenant PATH (never a URL that expires).
 * The scan viewer (`resolveScan`) signs a bare path since this PR. In local dev
 * (no bucket) rows keep the dev route URL, which is what the dev viewer serves.
 * Every form maps to the same ref through `toObjectRef`.
 */
export const STORE_OBJECT_PATH = true;

/** The validated ref for a path under the tenant prefix, else null (foreign, traversal, junk). */
export function tenantPath(restaurantId: string, path: string): string | null {
  if (typeof path !== 'string' || path.includes('..') || path.includes('\\')) return null;
  const prefix = `${restaurantId}/`;
  if (!restaurantId || !path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return SCAN_FILE.test(rest) ? path : null;
}

/** The scan id of a validated ref (`scan-…`, no extension). */
export function scanIdOf(ref: string): string {
  const file = ref.slice(ref.indexOf('/') + 1);
  return file.replace(/\.[a-z0-9]+$/i, '');
}

/** The extension of a ref (null for an extension-less local ref). */
export function extOf(ref: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(ref.slice(ref.indexOf('/') + 1));
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Tenant storage path for a raw_image_url (legacy signed URL, stable unsigned
 * URL, local dev URL) or a bare path. Null for anything outside
 * `${restaurantId}/` — never another tenant's object.
 */
export function toObjectRef(rawImageUrlOrPath: string, restaurantId: string): string | null {
  if (!rawImageUrlOrPath) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(rawImageUrlOrPath)) return tenantPath(restaurantId, rawImageUrlOrPath);
  const local = scanIdFromLocalUrl(rawImageUrlOrPath);
  if (local) return tenantPath(restaurantId, `${restaurantId}/${local}`);
  let pathname: string;
  try {
    pathname = new URL(rawImageUrlOrPath).pathname;
  } catch {
    return null;
  }
  const m = SIGNED_OBJECT.exec(pathname);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return tenantPath(restaurantId, decoded);
}

/** A short-lived URL for OCR (signed bucket URL, or the local dev route). */
export async function signObjectRef(restaurantId: string, ref: string): Promise<string | null> {
  const path = tenantPath(restaurantId, ref);
  if (!path) return null;
  const url = await signedUrlForStoragePath(restaurantId, path);
  return url && isAllowedScanUrl(url) ? url : null;
}

/** What a NEW row keeps in `invoices.raw_image_url` for this ref (see STORE_OBJECT_PATH). */
export function storedImageValue(restaurantId: string, ref: string): string {
  if (localScanStorageEnabled()) return localScanUrl(scanIdOf(ref));
  if (STORE_OBJECT_PATH) return ref;
  const prefix = allowedScanUrlPrefix();
  return prefix ? `${prefix}${ref}` : ref;
}

/**
 * Every value an existing row may hold for this object, compared against
 * `split_part(raw_image_url, '?', 1)`: the path, the unsigned bucket URL (a
 * legacy signed URL minus its token) and the local dev URL.
 */
export function objectRefMatchValues(restaurantId: string, ref: string): string[] {
  const out = new Set<string>([ref]);
  const prefix = allowedScanUrlPrefix();
  if (prefix) {
    out.add(`${prefix}${ref}`);
    // Supabase signs with an encoded path segment-by-segment; ids are URL-safe, so both are equal.
  }
  if (localScanStorageEnabled()) out.add(localScanUrl(scanIdOf(ref)));
  if (!extOf(ref)) {
    // An extension-less (local) ref also matches the same object stored with any extension.
    for (const ext of ['jpg', 'png', 'pdf', 'webp']) out.add(`${ref}.${ext}`);
  }
  return [...out];
}
