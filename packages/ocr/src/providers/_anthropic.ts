/**
 * Shared Anthropic plumbing for the document extractors (invoice + purchase
 * order). Keeps the PDF/image content-block handling, byte resolution and
 * JSON isolation in one place so the invoice and PO parsers stay in sync.
 *
 * The SDK is imported LAZILY by callers (dynamic import) so these packages
 * typecheck and unit-test even when `@anthropic-ai/sdk` is not installed.
 */

import type { ImageSource } from '../types';

export type MediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export interface ImagePayload {
  /** http(s) URL string, or null when we resolved to bytes. */
  url: string | null;
  /** base64-encoded bytes, when url is null. */
  data: string | null;
  mediaType: MediaType;
}

/** Loose alias for the lazily-imported SDK content block (no compile-time SDK dep). */
export type AnthropicContentBlock = Record<string, unknown>;

export function detectImageMime(buf: Buffer): MediaType {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return 'image/jpeg';
}

export function mediaTypeFromUrl(url: string): MediaType {
  if (/\.pdf(\?|#|$)/i.test(url)) return 'application/pdf';
  if (/\.png(\?|#|$)/i.test(url)) return 'image/png';
  if (/\.webp(\?|#|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

/** Resolve the ImageSource into either a URL or base64 bytes + media type. */
export async function resolveImage(image: ImageSource, fetchBytes: boolean): Promise<ImagePayload> {
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
    // Private bucket: fetch the bytes ourselves and send base64.
    const res = await fetch(asUrl);
    if (!res.ok) {
      throw new Error(
        `Anthropic: failed to fetch document (${res.status}) from ${asUrl.slice(0, 80)}`,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { url: null, data: buf.toString('base64'), mediaType: detectImageMime(buf) };
  }

  // Bare non-URL string → assume base64-encoded image bytes.
  return { url: null, data: image as string, mediaType: 'image/jpeg' };
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

/** Extract the model's text output and isolate the JSON object. */
export function parseJsonFromText(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Anthropic: no JSON object found in response: ${cleaned.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Concatenate the text blocks of an Anthropic messages response. */
export function joinTextBlocks(content: unknown): string {
  return ((content as Array<{ type?: string; text?: string }>) ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}
