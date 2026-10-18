import { describe, expect, it, vi } from 'vitest';
import {
  isShowcaseScanUrl,
  SHOWCASE_MAX_BYTES,
  uploadShowcaseScan,
  validateShowcaseFile,
} from '../lib/showcaseUpload';

/** SB-3: the public showcase uploads through the server, never with the anon key. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

function fakeStorage(opts: { uploadError?: boolean; signError?: boolean } = {}) {
  const calls = { upload: [] as Array<{ path: string; opts: unknown }>, remove: [] as string[][] };
  const bucket = {
    upload: vi.fn(async (path: string, _bytes: Uint8Array, o: unknown) => {
      calls.upload.push({ path, opts: o });
      return { error: opts.uploadError ? { message: 'boom' } : null };
    }),
    createSignedUrl: vi.fn(async (path: string, ttl: number) =>
      opts.signError
        ? { data: null, error: { message: 'nope' } }
        : { data: { signedUrl: `https://sb.test/storage/v1/object/sign/invoice-scans/${path}?token=t&ttl=${ttl}` }, error: null },
    ),
    remove: vi.fn(async (paths: string[]) => {
      calls.remove.push(paths);
      return { error: null };
    }),
  };
  const from = vi.fn(() => bucket);
  return { storage: { storage: { from } } as never, calls, from };
}

describe('validateShowcaseFile', () => {
  it('accepts allowed types whose bytes match', () => {
    expect(validateShowcaseFile(JPEG, 'image/jpeg')).toEqual({ ok: true });
    expect(validateShowcaseFile(PDF, 'application/pdf')).toEqual({ ok: true });
  });
  it('rejects disallowed types, mismatched magic bytes, empty and oversize files', () => {
    expect(validateShowcaseFile(JPEG, 'text/html')).toMatchObject({ ok: false, error: 'unsupported_type' });
    expect(validateShowcaseFile(PDF, 'image/jpeg')).toMatchObject({ ok: false, error: 'type_mismatch' });
    expect(validateShowcaseFile(new Uint8Array(), 'image/jpeg')).toMatchObject({ ok: false, error: 'empty' });
    const big = new Uint8Array(SHOWCASE_MAX_BYTES + 1);
    big.set(JPEG);
    expect(validateShowcaseFile(big, 'image/jpeg')).toMatchObject({ ok: false, error: 'too_large', status: 413 });
  });
});

describe('uploadShowcaseScan', () => {
  it('uploads under walk-ins/<day>/ with the service client (no upsert) and returns a signed URL', async () => {
    const { storage, calls, from } = fakeStorage();
    const r = await uploadShowcaseScan(storage, JPEG, 'image/jpeg', new Date('2026-10-18T10:00:00Z'));
    expect(from).toHaveBeenCalledWith('invoice-scans');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.storagePath).toMatch(/^walk-ins\/2026-10-18\/walk-[a-z0-9]+-[a-f0-9]{12}\.jpg$/);
    expect(calls.upload[0]!.opts).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(r.signedUrl).toContain('ttl=600');
  });

  it('never writes an invalid file', async () => {
    const { storage, calls } = fakeStorage();
    const r = await uploadShowcaseScan(storage, PDF, 'image/png');
    expect(r).toMatchObject({ ok: false, error: 'type_mismatch' });
    expect(calls.upload).toHaveLength(0);
  });

  it('reports upload failure, and removes the object when signing fails', async () => {
    expect(await uploadShowcaseScan(fakeStorage({ uploadError: true }).storage, JPEG, 'image/jpeg')).toMatchObject({
      ok: false,
      error: 'upload_failed',
    });
    const s = fakeStorage({ signError: true });
    expect(await uploadShowcaseScan(s.storage, JPEG, 'image/jpeg')).toMatchObject({ ok: false });
    expect(s.calls.remove).toHaveLength(1);
  });
});

describe('isShowcaseScanUrl (public OCR endpoint input)', () => {
  const SB = 'https://sb.test';
  const ok = `${SB}/storage/v1/object/sign/invoice-scans/walk-ins/2026-10-18/walk-a-b.jpg?token=t`;
  it('accepts only walk-in signed URLs', () => {
    expect(isShowcaseScanUrl(ok, SB)).toBe(true);
    expect(isShowcaseScanUrl(ok, `${SB}/`)).toBe(true);
  });
  it('rejects tenant scans, other hosts, traversal and encoded separators', () => {
    const base = `${SB}/storage/v1/object/sign/invoice-scans/`;
    expect(isShowcaseScanUrl(`${base}11111111-1111-4111-8111-111111111111/scan-x.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`https://evil.test/storage/v1/object/sign/invoice-scans/walk-ins/x.jpg`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/../rid/scan.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/%2e%2e/rid/scan.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/..%2frid%2fscan.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(ok, undefined)).toBe(false);
  });
  it('rejects tab / newline smuggling that URL parsing would turn into ../ (refuter #7)', () => {
    const base = `${SB}/storage/v1/object/sign/invoice-scans/`;
    expect(new URL(`${base}walk-ins/.\t./tenant-1/x.jpg`).pathname).toContain('/invoice-scans/tenant-1/');
    expect(isShowcaseScanUrl(`${base}walk-ins/.\t./tenant-1/x.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/.\n./tenant-1/x.jpg?token=t`, SB)).toBe(false);
    expect(isShowcaseScanUrl(`${base}walk-ins/.\r./tenant-1/x.jpg?token=t`, SB)).toBe(false);
  });
});
