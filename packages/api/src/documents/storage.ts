import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  localScanDir,
  localScanStorageEnabled,
  readLocalScan,
  saveLocalScan,
} from '../lib/localScanStorage';
import { extFromMime, getServiceStorageClient } from '../lib/supabaseStorage';
import { INVOICE_SCANS_BUCKET } from '../lib/scanUrls';
import { extOf, scanIdOf } from './objectRef';

/**
 * Object IO for documents — the private `invoice-scans` bucket, or the
 * dev-only local disk. Paths are ALREADY validated tenant refs (objectRef.ts).
 * Injectable so tests can count reads and fail writes.
 */
export interface DocumentStorage {
  /** The bytes, or null when the object does not exist. */
  read(restaurantId: string, path: string): Promise<Uint8Array | null>;
  /** Write once (no overwrite; an existing object is left as is). Throws on failure. */
  write(restaurantId: string, path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  /** Best-effort delete. */
  remove(restaurantId: string, paths: string[]): Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function localDocumentStorage(): DocumentStorage {
  return {
    async read(restaurantId, path) {
      const hit = await readLocalScan(restaurantId, scanIdOf(path));
      if (!hit) return null;
      const ext = extOf(path);
      if (ext && hit.meta.ext !== ext) return null;
      return new Uint8Array(hit.bytes);
    },
    async write(restaurantId, path, bytes, mimeType) {
      await saveLocalScan({
        restaurantId,
        scanId: scanIdOf(path),
        ext: extOf(path) ?? extFromMime(mimeType),
        mimeType,
        bytes: Buffer.from(bytes),
      });
    },
    async remove(restaurantId, paths) {
      const dir = join(localScanDir(), restaurantId);
      for (const p of paths) {
        const scanId = scanIdOf(p);
        let ext = extOf(p);
        if (!ext) {
          try {
            ext = (JSON.parse(await readFile(join(dir, `${scanId}.json`), 'utf8')) as { ext?: string }).ext ?? null;
          } catch {
            ext = null;
          }
        }
        for (const f of [ext ? `${scanId}.${ext}` : null, `${scanId}.json`]) {
          if (f) await unlink(join(dir, f)).catch(() => undefined);
        }
      }
    },
  };
}

export function bucketDocumentStorage(): DocumentStorage | null {
  const client = getServiceStorageClient();
  if (!client) return null;
  const bucket = () => client.storage.from(INVOICE_SCANS_BUCKET);
  return {
    async read(_restaurantId, path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async write(_restaurantId, path, bytes, mimeType) {
      const { error } = await bucket().upload(path, Buffer.from(bytes), {
        contentType: mimeType || MIME_BY_EXT[extOf(path) ?? ''] || 'application/octet-stream',
        upsert: false,
      });
      if (error && !/exist|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) {
        throw new Error(`upload failed: ${error.message}`);
      }
    },
    async remove(_restaurantId, paths) {
      if (paths.length > 0) await bucket().remove(paths);
    },
  };
}

/** The configured storage: the bucket, else local disk in dev, else null. */
export function defaultDocumentStorage(): DocumentStorage | null {
  return bucketDocumentStorage() ?? (localScanStorageEnabled() ? localDocumentStorage() : null);
}
