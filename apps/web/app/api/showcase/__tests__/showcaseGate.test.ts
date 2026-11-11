import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pilot kill-switch for the public showcase (SHOWCASE_REAL_OCR). Off → both
 * routes answer 503 before reading the body, touching storage or constructing
 * the Claude client; on → the existing behaviour.
 */
const h = vi.hoisted(() => ({
  visionCtor: vi.fn(),
  extract: vi.fn(),
  storageClient: vi.fn(),
  uploadScan: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@restomatch/ocr', () => ({
  ClaudeVision: class {
    constructor(opts: unknown) {
      h.visionCtor(opts);
    }
    extract = h.extract;
  },
}));

vi.mock('@restomatch/api', () => ({
  SHOWCASE_MAX_BYTES: 4 * 1024 * 1024,
  clientIpFromHeaders: () => '203.0.113.7',
  isOriginAllowed: ({ origin, host }: { origin: string | null; host: string | null }) =>
    origin !== null && host !== null && new URL(origin).host === host,
  showcaseScanFetchUrl: (url: string) => (url.includes('/object/sign/invoice-scans/walk-ins/') ? url : null),
  getServiceStorageClient: () => h.storageClient(),
  uploadShowcaseScan: (...args: unknown[]) => h.uploadScan(...args),
}));

vi.mock('@/lib/rateLimit', () => ({
  trustedProxyHops: () => 1,
  enforceOcrLimit: () => h.rateLimit(),
  enforceRateLimit: () => h.rateLimit(),
}));

vi.mock('@/lib/env', () => ({ ownerDbUrl: () => null }));

const { POST: ocrPost } = await import('../ocr/route');
const { POST: uploadPost } = await import('../upload/route');

const SIGNED = 'https://sb.example/storage/v1/object/sign/invoice-scans/walk-ins/2026-10-31/a.jpg?token=t';
const sameOrigin = { origin: 'http://localhost:3000', host: 'localhost:3000' };

function ocrRequest(body: unknown = { url: SIGNED }) {
  const text = JSON.stringify(body);
  return new Request('http://localhost:3000/api/showcase/ocr', {
    method: 'POST',
    headers: { ...sameOrigin, 'content-type': 'application/json', 'content-length': String(text.length) },
    body: text,
  });
}

function uploadRequest() {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'a.jpg', { type: 'image/jpeg' }));
  return new Request('http://localhost:3000/api/showcase/upload', { method: 'POST', headers: sameOrigin, body: form });
}

/** A request whose body throws when read, to prove the gate never reads it. */
function untouchableRequest(path: string) {
  const req = new Request(`http://localhost:3000${path}`, { method: 'POST', headers: sameOrigin, body: 'x' });
  const fail = () => {
    throw new Error('body read while the showcase is off');
  };
  Object.defineProperty(req, 'json', { value: fail });
  Object.defineProperty(req, 'formData', { value: fail });
  Object.defineProperty(req, 'arrayBuffer', { value: fail });
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  h.rateLimit.mockResolvedValue({ allowed: true, resetSec: 0 });
  h.extract.mockResolvedValue({ lines: [{ description: 'עגבניות', quantity: 1 }] });
  h.storageClient.mockReturnValue({});
  h.uploadScan.mockResolvedValue({ ok: true, scanId: 's1', signedUrl: SIGNED, mimeType: 'image/jpeg' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ['unset', undefined],
  ['0', '0'],
  ['true (only "1" turns it on)', 'true'],
])('SHOWCASE_REAL_OCR %s → off', (_label, value) => {
  beforeEach(() => {
    if (value === undefined) delete process.env.SHOWCASE_REAL_OCR;
    else vi.stubEnv('SHOWCASE_REAL_OCR', value);
  });

  it('/ocr answers 503 showcase_ocr_off and never builds the Claude client', async () => {
    const res = await ocrPost(untouchableRequest('/api/showcase/ocr'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: 'showcase_ocr_off' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(h.visionCtor).not.toHaveBeenCalled();
    expect(h.extract).not.toHaveBeenCalled();
    expect(h.rateLimit).not.toHaveBeenCalled();
  });

  it('/upload answers 503 (the client keeps the local preview) and writes nothing', async () => {
    const res = await uploadPost(untouchableRequest('/api/showcase/upload'));
    expect(res.status).toBe(503);
    // `not_configured` is what lib/supabase/client.ts maps to the local demo mode.
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_configured', code: 'showcase_ocr_off' });
    expect(h.storageClient).not.toHaveBeenCalled();
    expect(h.uploadScan).not.toHaveBeenCalled();
  });
});

describe('SHOWCASE_REAL_OCR=1 → current behaviour', () => {
  beforeEach(() => {
    vi.stubEnv('SHOWCASE_REAL_OCR', '1');
  });

  it('/ocr extracts a walk-in scan with Claude Vision', async () => {
    const res = await ocrPost(ocrRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { lines: [{ description: 'עגבניות' }] } });
    expect(h.visionCtor).toHaveBeenCalledTimes(1);
    expect(h.extract).toHaveBeenCalledWith(SIGNED);
  });

  it('/ocr keeps its guards: cross-origin 403, rate limit 429, foreign URL 400, no key 503', async () => {
    const cross = new Request('http://localhost:3000/api/showcase/ocr', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ url: SIGNED }),
    });
    expect((await ocrPost(cross)).status).toBe(403);

    h.rateLimit.mockResolvedValueOnce({ allowed: false, resetSec: 60 });
    expect((await ocrPost(ocrRequest())).status).toBe(429);

    expect((await ocrPost(ocrRequest({ url: 'https://evil.example/x.jpg' }))).status).toBe(400);

    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const noKey = await ocrPost(ocrRequest());
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).not.toMatchObject({ code: 'showcase_ocr_off' });
    expect(h.visionCtor).not.toHaveBeenCalled();
  });

  it('/upload stores the file and returns a signed URL', async () => {
    const res = await uploadPost(uploadRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, scanId: 's1', signedUrl: SIGNED });
    expect(h.uploadScan).toHaveBeenCalledTimes(1);
  });

  it('/upload without storage configured still answers not_configured (local dev)', async () => {
    h.storageClient.mockReturnValueOnce(null);
    const res = await uploadPost(uploadRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'not_configured' });
  });
});
