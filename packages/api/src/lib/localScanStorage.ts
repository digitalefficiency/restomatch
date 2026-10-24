/**
 * Local-disk invoice-scan storage — DEVELOPMENT ONLY.
 *
 * Production stores scans in the private Supabase `invoice-scans` bucket. On a
 * laptop without Supabase env the upload step used to fail with
 * PRECONDITION_FAILED, so the receiving flow (scan → OCR → reconcile → confirm)
 * could not be demoed locally. This adapter writes the bytes plus a small JSON
 * sidecar under `<LOCAL_SCAN_DIR>/<restaurantId>/<scanId>.<ext>`.
 *
 * GUARDS:
 *  - never enabled when NODE_ENV === 'production' (tested), nor when Supabase
 *    storage IS configured, nor with LOCAL_SCAN_STORAGE=0;
 *  - the restaurant directory comes from the authenticated session, never from
 *    client input, so a read is tenant-scoped by construction;
 *  - scan ids are validated against a strict pattern (no path traversal).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTrailingSlashes } from './urls';

const SCAN_ID = /^scan-[a-z0-9]+-[a-f0-9]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL) && (env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY));
}

export function localScanStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (env.LOCAL_SCAN_STORAGE === '0') return false;
  return !supabaseStorageConfigured(env);
}

export function localScanDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCAL_SCAN_DIR || join(tmpdir(), 'restomatch-scans');
}

export function isLocalScanId(scanId: string): boolean {
  return SCAN_ID.test(scanId);
}

/** URL the app serves a local scan at (auth + tenant checked by the route). */
export function localScanUrl(scanId: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = stripTrailingSlashes(env.APP_URL ?? env.AUTH_URL ?? 'http://localhost:3000');
  return `${base}/scans/${scanId}/file`;
}

/** Extract the scan id from a URL produced by localScanUrl (null otherwise). */
export function scanIdFromLocalUrl(url: string): string | null {
  const m = /\/scans\/(scan-[a-z0-9]+-[a-f0-9]{8})\/file(?:[?#].*)?$/.exec(url);
  return m ? m[1]! : null;
}

export interface LocalScanMeta {
  scanId: string;
  restaurantId: string;
  mimeType: string;
  ext: string;
  supplierName: string | null;
  createdAt: string;
}

function assertSafe(restaurantId: string, scanId: string): void {
  if (!UUID.test(restaurantId)) throw new Error('invalid restaurant id');
  if (!isLocalScanId(scanId)) throw new Error('invalid scan id');
}

export async function saveLocalScan(args: {
  restaurantId: string;
  scanId: string;
  ext: string;
  mimeType: string;
  bytes: Buffer;
  supplierName?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ created: boolean; meta: LocalScanMeta }> {
  const env = args.env ?? process.env;
  if (!localScanStorageEnabled(env)) throw new Error('local scan storage is disabled');
  assertSafe(args.restaurantId, args.scanId);
  const dir = join(localScanDir(env), args.restaurantId);
  await mkdir(dir, { recursive: true });

  const existing = await readLocalScanMeta(args.restaurantId, args.scanId, env);
  if (existing) return { created: false, meta: existing };

  const meta: LocalScanMeta = {
    scanId: args.scanId,
    restaurantId: args.restaurantId,
    mimeType: args.mimeType,
    ext: args.ext.replace(/[^a-z0-9]/gi, '') || 'bin',
    supplierName: args.supplierName ?? null,
    createdAt: new Date().toISOString(),
  };
  await writeFile(join(dir, `${args.scanId}.${meta.ext}`), args.bytes);
  await writeFile(join(dir, `${args.scanId}.json`), JSON.stringify(meta));
  return { created: true, meta };
}

export async function readLocalScanMeta(
  restaurantId: string,
  scanId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalScanMeta | null> {
  if (!localScanStorageEnabled(env)) return null;
  if (!UUID.test(restaurantId) || !isLocalScanId(scanId)) return null;
  try {
    const raw = await readFile(join(localScanDir(env), restaurantId, `${scanId}.json`), 'utf8');
    const meta = JSON.parse(raw) as LocalScanMeta;
    return meta.restaurantId === restaurantId ? meta : null;
  } catch {
    return null;
  }
}

/** Bytes + meta of a local scan, ONLY for the given (session) restaurant. */
export async function readLocalScan(
  restaurantId: string,
  scanId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ meta: LocalScanMeta; bytes: Buffer } | null> {
  const meta = await readLocalScanMeta(restaurantId, scanId, env);
  if (!meta) return null;
  try {
    const bytes = await readFile(join(localScanDir(env), restaurantId, `${scanId}.${meta.ext}`));
    return { meta, bytes };
  } catch {
    return null;
  }
}
