/**
 * Size + type limits for public ingest webhooks. Same document types and the
 * same per-file ceiling as the authenticated upload (scans.upload).
 */
export const INGEST_LIMITS = {
  /** WhatsApp webhooks carry JSON only (media is fetched separately). */
  whatsappBodyBytes: 256 * 1024,
  /** Inbound e-mail may inline base64 attachments (Postmark-style). */
  emailBodyBytes: 20 * 1024 * 1024,
  /** One document (decoded). Matches scans.upload (~10 MB). */
  attachmentBytes: 10 * 1024 * 1024,
  /** Attachments processed per message; the rest are recorded as skipped. */
  attachmentsPerMessage: 10,
} as const;

/**
 * Daily cap on bytes stored for documents that are NOT auto-registered (review
 * inbox) per channel — unknown senders cost storage without OCR, so a flood of
 * them must not grow storage without bound. Override with INGEST_REVIEW_BYTES_PER_DAY.
 */
export function reviewBytesPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.INGEST_REVIEW_BYTES_PER_DAY ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 200 * 1024 * 1024;
}

export const INGEST_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type IngestMime = (typeof INGEST_ALLOWED_MIME)[number];

export function isAllowedMime(mime: string | null | undefined): mime is IngestMime {
  return (INGEST_ALLOWED_MIME as readonly string[]).includes((mime ?? '').toLowerCase().split(';')[0]!.trim());
}

/**
 * Detect the real type from magic bytes. The declared Content-Type of an
 * attachment is attacker-controlled; we store and OCR only what the bytes say.
 */
export function sniffMime(bytes: Uint8Array): IngestMime | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf'; // %PDF-
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'; // RIFF....WEBP
  }
  return null;
}
