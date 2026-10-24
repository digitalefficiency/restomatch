import { createHash } from 'node:crypto';
import { INGEST_LIMITS } from './limits';
import type { IngestKind } from './tokens';

/**
 * Provider interface: everything that talks to WhatsApp / the e-mail provider
 * goes through here, so tests and local demos run on a deterministic stub with
 * no network, no account and no credentials (MASTER-PLAN §1.6).
 */
export interface FetchedAttachment {
  bytes: Uint8Array;
  /** Provider-reported type (still untrusted — the pipeline sniffs bytes). */
  mimeType: string | null;
}

export interface IngestProvider {
  readonly kind: IngestKind;
  /** 'stub' | 'meta-cloud' | 'resend' — recorded on each message for support. */
  readonly name: string;
  /** Download one attachment the webhook referenced by handle. */
  fetchAttachment(args: { providerMessageId: string; ref: string }): Promise<FetchedAttachment>;
}

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment exceeds the size limit');
    this.name = 'AttachmentTooLargeError';
  }
}

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

/** Thrown in production when the live provider is not configured — never fake bytes. */
export class UnavailableIngestProvider implements IngestProvider {
  readonly name = 'unavailable';
  constructor(readonly kind: IngestKind) {}
  async fetchAttachment(): Promise<FetchedAttachment> {
    throw new Error('live provider not configured');
  }
}

/** Read a fetch Response body, aborting once it passes `max` bytes. */
export async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) throw new AttachmentTooLargeError();
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new AttachmentTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/* ── Deterministic stub (local + tests) ──────────────────────────────────── */

/**
 * A minimal valid PNG whose bytes depend only on the ref, so the same media id
 * always yields the same document (same sha256 → same dedupe key).
 */
export function stubDocumentBytes(ref: string): Uint8Array {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  // Append a tEXt-free trailer after IEND: decoders ignore it, the hash changes.
  const tag = createHash('sha256').update(`stub:${ref}`).digest();
  return new Uint8Array(Buffer.concat([png, tag]));
}

export class StubIngestProvider implements IngestProvider {
  readonly name = 'stub';
  private readonly files = new Map<string, FetchedAttachment>();

  constructor(readonly kind: IngestKind) {}

  /** Tests: make `ref` resolve to specific bytes. */
  register(ref: string, file: FetchedAttachment): this {
    this.files.set(ref, file);
    return this;
  }

  async fetchAttachment({ ref }: { providerMessageId: string; ref: string }): Promise<FetchedAttachment> {
    const known = this.files.get(ref);
    if (known) {
      if (known.bytes.byteLength > INGEST_LIMITS.attachmentBytes) throw new AttachmentTooLargeError();
      return known;
    }
    return { bytes: stubDocumentBytes(ref), mimeType: 'image/png' };
  }
}

/* ── WhatsApp Business Cloud API (Graph) ─────────────────────────────────── */

export class MetaCloudWhatsAppProvider implements IngestProvider {
  readonly kind = 'whatsapp' as const;
  readonly name = 'meta-cloud';

  constructor(
    private readonly accessToken: string,
    private readonly graphVersion = 'v21.0',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchAttachment({ ref }: { providerMessageId: string; ref: string }): Promise<FetchedAttachment> {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(ref)) throw new Error('invalid media id');
    const auth = { Authorization: `Bearer ${this.accessToken}` };
    const meta = await this.fetchImpl(`https://graph.facebook.com/${this.graphVersion}/${ref}`, {
      headers: auth,
      signal: timeoutSignal(15_000),
    });
    if (!meta.ok) throw new Error(`media lookup failed: HTTP ${meta.status}`);
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (typeof info.file_size === 'number' && info.file_size > INGEST_LIMITS.attachmentBytes) {
      throw new AttachmentTooLargeError();
    }
    // Media URLs are served from Meta's CDN; refuse anything else (no SSRF).
    if (!info.url || !/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//i.test(info.url)) {
      throw new Error('unexpected media url');
    }
    const file = await this.fetchImpl(info.url, { headers: auth, signal: timeoutSignal(30_000) });
    if (!file.ok) throw new Error(`media download failed: HTTP ${file.status}`);
    return { bytes: await readLimited(file, INGEST_LIMITS.attachmentBytes), mimeType: info.mime_type ?? null };
  }
}

/* ── Resend inbound (attachments fetched by id) ──────────────────────────── */

export class ResendInboundProvider implements IngestProvider {
  readonly kind = 'email' as const;
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.resend.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchAttachment({ providerMessageId, ref }: { providerMessageId: string; ref: string }): Promise<FetchedAttachment> {
    const safe = /^[A-Za-z0-9_-]{1,128}$/;
    if (!safe.test(providerMessageId) || !safe.test(ref)) throw new Error('invalid attachment handle');
    const auth = { Authorization: `Bearer ${this.apiKey}` };
    const meta = await this.fetchImpl(
      `${this.baseUrl}/emails/receiving/${providerMessageId}/attachments/${ref}`,
      { headers: auth, signal: timeoutSignal(15_000) },
    );
    if (!meta.ok) throw new Error(`attachment lookup failed: HTTP ${meta.status}`);
    const info = (await meta.json()) as { download_url?: string; content_type?: string; size?: number };
    if (typeof info.size === 'number' && info.size > INGEST_LIMITS.attachmentBytes) throw new AttachmentTooLargeError();
    if (!info.download_url || !info.download_url.startsWith('https://')) throw new Error('unexpected attachment url');
    const file = await this.fetchImpl(info.download_url, { signal: timeoutSignal(30_000) });
    if (!file.ok) throw new Error(`attachment download failed: HTTP ${file.status}`);
    return { bytes: await readLimited(file, INGEST_LIMITS.attachmentBytes), mimeType: info.content_type ?? null };
  }
}
