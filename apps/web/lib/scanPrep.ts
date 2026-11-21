/**
 * Shrink a captured invoice before upload (EN-2).
 *
 * Phone cameras produce 4–12 MB photos. The authenticated upload sends the
 * file base64-encoded inside a tRPC request (+33%) and the showcase posts it to
 * a Vercel Function — both behind Vercel's 4.5 MB request-body limit — so
 * anything over ~3.3 MB used to fail. Photos are re-encoded in the browser
 * (long edge ≤ 2000 px, JPEG ~0.8, EXIF orientation applied — plenty for OCR);
 * PDFs can't be shrunk client-side and are rejected with a clear message
 * when over the limit.
 */

/** Raw bytes we send. base64 of 3 MB ≈ 4 MB + JSON overhead < 4.5 MB. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** Long edge for OCR-quality invoice photos. */
export const MAX_EDGE_PX = 2000;
/** Re-encode anything above this even when the pixels already fit. */
const REENCODE_ABOVE_BYTES = 1.5 * 1024 * 1024;
/** Fallback ladder when the first pass is still too big. */
const LADDER: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: MAX_EDGE_PX, quality: 0.8 },
  { edge: MAX_EDGE_PX, quality: 0.65 },
  { edge: 1600, quality: 0.65 },
  { edge: 1280, quality: 0.6 },
];

export type ScanPrepErrorCode = 'too_large' | 'unsupported_type';

export class ScanPrepError extends Error {
  constructor(
    readonly code: ScanPrepErrorCode,
    readonly maxMb: number = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)),
  ) {
    super(code);
    this.name = 'ScanPrepError';
  }
}

export interface PreparedScan {
  file: File;
  /** True when the photo was re-encoded / downscaled. */
  downscaled: boolean;
}

/** Scale (w, h) so the long edge is ≤ maxEdge, preserving aspect ratio. */
export function targetSize(w: number, h: number, maxEdge: number = MAX_EDGE_PX): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge || long <= 0) return { w, h };
  const k = maxEdge / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function jpegName(name: string): string {
  return `${name.replace(/\.[a-z0-9]+$/i, '') || 'invoice'}.jpg`;
}

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob | null> {
  const { w, h } = targetSize(bitmap.width, bitmap.height, edge);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // JPEG has no alpha: paint white first or a transparent PNG turns black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/**
 * Make `file` uploadable: images are downscaled/re-encoded as needed, PDFs pass
 * through. Throws ScanPrepError('too_large' | 'unsupported_type').
 */
export async function prepareScanFile(file: File): Promise<PreparedScan> {
  const type = file.type || 'application/octet-stream';
  const isImage = type.startsWith('image/');

  if (!isImage) {
    if (!ALLOWED.has(type)) throw new ScanPrepError('unsupported_type');
    if (file.size > MAX_UPLOAD_BYTES) throw new ScanPrepError('too_large');
    return { file, downscaled: false };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    // 'from-image' applies the EXIF orientation, so a portrait phone photo
    // isn't sideways after re-encoding.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
      // Older Safari rejects the options bag; it already honours EXIF there.
      createImageBitmap(file),
    );
  } catch {
    bitmap = null;
  }

  if (!bitmap) {
    // The browser can't decode it (HEIC from the iPhone gallery in Chrome, a
    // broken file): never send it — the OCR would fail on it at the back door.
    // The receiver is told to photograph again with the camera (pilot brief).
    throw new ScanPrepError('unsupported_type');
  }

  try {
    const fits = Math.max(bitmap.width, bitmap.height) <= MAX_EDGE_PX;
    if (fits && file.size <= REENCODE_ABOVE_BYTES && ALLOWED.has(type)) {
      return { file, downscaled: false };
    }
    for (const step of LADDER) {
      const blob = await encode(bitmap, step.edge, step.quality);
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        return {
          file: new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() }),
          downscaled: true,
        };
      }
    }
    throw new ScanPrepError('too_large');
  } finally {
    bitmap.close();
  }
}

/** Base64 of a Blob (chunked — large photos overflow String.fromCharCode). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The last guard before a scan is base64-encoded into a request (the wizard's
 * upload and the offline PWA queue): a file that already fits and is of an
 * accepted type goes as it is (the scan step prepared it); anything else is
 * prepared now. Throws ScanPrepError — and then NO request is sent.
 */
export async function ensureUploadable(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES && ALLOWED.has(file.type)) return file;
  return (await prepareScanFile(file)).file;
}

/** Prepare `file` and hand it to `send` with its base64 — or throw before any request. */
export async function uploadScanFile<T>(file: File, send: (ready: File, contentBase64: string) => Promise<T>): Promise<T> {
  const ready = await ensureUploadable(file);
  return send(ready, await blobToBase64(ready));
}
