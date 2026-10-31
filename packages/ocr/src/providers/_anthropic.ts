/**
 * Shared Anthropic plumbing for the document extractors (invoice + purchase
 * order). Keeps the PDF/image content-block handling, byte resolution and
 * JSON isolation in one place so the invoice and PO parsers stay in sync.
 *
 * The SDK is imported LAZILY by callers (dynamic import) so these packages
 * typecheck and unit-test even when `@anthropic-ai/sdk` is not installed.
 */

import { OcrExtractionError } from '../errors';
import type { ImageSource } from '../types';

export type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'application/pdf';

export interface ImagePayload {
  /** http(s) URL string, or null when we resolved to bytes. */
  url: string | null;
  /** base64-encoded bytes, when url is null. */
  data: string | null;
  mediaType: MediaType;
}

/** Loose alias for the lazily-imported SDK content block (no compile-time SDK dep). */
export type AnthropicContentBlock = Record<string, unknown>;

/** ISO-BMFF brands of iPhone HEIC/HEIF photos (bytes 4..12 = "ftyp" + brand). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif']);

/**
 * Media type from the magic bytes. HEIC/HEIF (an iPhone default) and anything
 * unrecognised throw a typed 'unsupported_format' — labelling them image/jpeg
 * made the API reject the request with an opaque 400.
 */
export function detectImageMime(buf: Buffer): MediaType {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (HEIF_BRANDS.has(brand)) {
      throw new OcrExtractionError('unsupported_format', `HEIC/HEIF photo (${brand}); send a JPEG, PNG or PDF`);
    }
  }
  throw new OcrExtractionError('unsupported_format', 'unrecognised file type; send a JPEG, PNG or PDF');
}

export function mediaTypeFromUrl(url: string): MediaType {
  if (/\.(heic|heif)(\?|#|$)/i.test(url)) {
    throw new OcrExtractionError('unsupported_format', 'HEIC/HEIF photo; send a JPEG, PNG or PDF');
  }
  if (/\.pdf(\?|#|$)/i.test(url)) return 'application/pdf';
  if (/\.png(\?|#|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|#|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Cap on downloading a scan ourselves (private bucket → base64). Without it a
 * storage host that accepts the connection and never answers held the OCR job
 * (and its worker slot) until BullMQ's stall detection; a signed URL that
 * expires mid-wait fails anyway. Override with OCR_FETCH_TIMEOUT_MS.
 */
export const DOCUMENT_FETCH_TIMEOUT_MS = 20_000;

export function documentFetchTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.OCR_FETCH_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DOCUMENT_FETCH_TIMEOUT_MS;
}

/** Resolve the ImageSource into either a URL or base64 bytes + media type. */
export async function resolveImage(
  image: ImageSource,
  fetchBytes: boolean,
  timeoutMs: number = documentFetchTimeoutMs(),
): Promise<ImagePayload> {
  // Buffer → always base64 (with magic-byte detection).
  if (Buffer.isBuffer(image)) {
    return { url: null, data: image.toString('base64'), mediaType: detectImageMime(image) };
  }

  const asUrl =
    image instanceof URL
      ? image.toString()
      : typeof image === 'string' && /^https?:\/\//i.test(image)
        ? image
        : null;

  if (asUrl) {
    const mediaType = mediaTypeFromUrl(asUrl);
    if (!fetchBytes) {
      return { url: asUrl, data: null, mediaType };
    }
    // Private bucket: fetch the bytes ourselves and send base64. The timeout
    // covers the headers AND the body (the signal also aborts arrayBuffer()).
    // AbortController + timer rather than AbortSignal.timeout(): the mobile
    // app type-checks this package against a lib without the static helper.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let buf: Buffer;
    try {
      const res = await fetch(asUrl, { signal: ctrl.signal });
      // No URL in the message: a signed scan URL is a bearer credential.
      if (!res.ok) throw new OcrExtractionError('fetch_failed', `document download failed (HTTP ${res.status})`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (ctrl.signal.aborted) {
        throw new OcrExtractionError('fetch_failed', `document download timed out after ${timeoutMs}ms`);
      }
      if (err instanceof OcrExtractionError) throw err;
      throw new OcrExtractionError('fetch_failed', 'document download failed (network error)');
    } finally {
      clearTimeout(timer);
    }
    return { url: null, data: buf.toString('base64'), mediaType: detectImageMime(buf) };
  }

  // Bare non-URL string → base64-encoded bytes; detect the type from them.
  const head = Buffer.from((image as string).slice(0, 64), 'base64');
  return { url: null, data: image as string, mediaType: detectImageMime(head) };
}

/** True when this source can never be delivered to Anthropic as a plain URL. */
export function mustFetchBytes(image: ImageSource): boolean {
  return !(image instanceof URL || (typeof image === 'string' && /^https?:\/\//i.test(image)));
}

/** Build the image/document content block for the Anthropic messages API. */
export function toContentBlock(payload: ImagePayload): AnthropicContentBlock {
  const blockType = payload.mediaType === 'application/pdf' ? 'document' : 'image';
  if (payload.url) {
    return { type: blockType, source: { type: 'url', url: payload.url } };
  }
  return {
    type: blockType,
    source: { type: 'base64', media_type: payload.mediaType, data: payload.data },
  };
}

/**
 * Extract the model's text output and isolate the FIRST complete JSON object.
 * Scans braces (string-aware) instead of using the last `}`, so a trailing
 * note after the object — which may itself contain braces — doesn't break
 * JSON.parse ("Unexpected non-whitespace character after JSON").
 */
export function parseJsonFromText(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) {
    // Never echo the model's text: it is invoice content (supplier, prices).
    throw new OcrExtractionError('invalid_output', `no JSON object found in the response (${cleaned.length} chars)`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        throw new OcrExtractionError('invalid_output', 'the JSON object in the response does not parse');
      }
    }
  }
  throw new OcrExtractionError('invalid_output', `unterminated JSON object in the response (${cleaned.length} chars)`);
}

/** Concatenate the text blocks of an Anthropic messages response. */
export function joinTextBlocks(content: unknown): string {
  return ((content as Array<{ type?: string; text?: string }>) ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}
