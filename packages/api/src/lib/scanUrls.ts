/**
 * Where invoice images may be fetched from (plan v2 S4 / Epic A.8).
 *
 * receiving.registerInvoice used to accept ANY https URL, which the worker then
 * fetched server-side with the owner DB + every API key in its environment — a
 * receiver-role user in any tenant could point it at internal hosts (SSRF). The
 * only legitimate source is a signed URL on our private `invoice-scans` bucket
 * (issued by scans.upload / the scan viewer), so pin to that prefix.
 *
 * When no Supabase URL is configured (local/test without storage) there is
 * nothing to pin to and the check is skipped — production always has it
 * (NEXT_PUBLIC_SUPABASE_URL is required for uploads to work at all).
 *
 * The durable fix — jobs carrying a storagePath the worker re-signs itself — is
 * Wave 3 (connector framework); this closes the hole today.
 */
export const INVOICE_SCANS_BUCKET = 'invoice-scans';

export function allowedScanUrlPrefix(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.INVOICE_SCAN_URL_PREFIX;
  if (explicit && explicit.length > 0) return explicit;
  const base = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/storage/v1/object/sign/${INVOICE_SCANS_BUCKET}/`;
}

export function isAllowedScanUrl(url: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const prefix = allowedScanUrlPrefix(env);
  if (!prefix) return true;
  if (!url.startsWith(prefix)) return false;
  // No path tricks after the prefix (../ or an embedded scheme).
  const rest = url.slice(prefix.length);
  return rest.length > 0 && !rest.includes('..') && !/^[a-z]+:/i.test(rest);
}
