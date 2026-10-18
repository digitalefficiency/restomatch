/**
 * Server-side Supabase Storage client (service-role) for invoice scans.
 *
 * SECURITY: this uses the SERVICE_ROLE key, which BYPASSES RLS. It is used only
 * from server-authoritative paths (scans.upload memberProcedure) where the
 * tenant id is derived from the authenticated session — never from client input.
 * The bucket is private; reads are served as short-lived signed URLs.
 *
 * Returns null when the env is not configured (e.g. local/test without Supabase)
 * so callers can fail with a clear, non-leaky error instead of crashing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getServiceStorageClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
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

/** Test seam: reset the memoized client (so env changes take effect). */
export function __resetServiceStorageClient(): void {
  cached = undefined;
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}
