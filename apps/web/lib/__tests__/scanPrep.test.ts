import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EDGE_PX, MAX_UPLOAD_BYTES, prepareScanFile, ScanPrepError, targetSize, uploadScanFile } from '../scanPrep';

/** EN-2: uploads must fit Vercel's 4.5 MB request body (base64 adds 33%). */
describe('targetSize', () => {
  it('keeps small images, scales the long edge down to 2000 px keeping aspect', () => {
    expect(targetSize(1200, 900)).toEqual({ w: 1200, h: 900 });
    expect(targetSize(4032, 3024)).toEqual({ w: 2000, h: 1500 });
    expect(targetSize(3024, 4032)).toEqual({ w: 1500, h: 2000 });
    expect(targetSize(8000, 10)).toEqual({ w: 2000, h: 3 });
  });
  it('the byte cap leaves room for base64 + envelope under 4.5 MB', () => {
    expect(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 64 * 1024).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('prepareScanFile (non-image / undecodable paths)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes a PDF through when it fits', async () => {
    const pdf = new File([new Uint8Array(1000)], 'inv.pdf', { type: 'application/pdf' });
    const r = await prepareScanFile(pdf);
    expect(r.file).toBe(pdf);
    expect(r.downscaled).toBe(false);
  });

  it('rejects a PDF over the limit with a clear coded error', async () => {
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.pdf', { type: 'application/pdf' });
    await expect(prepareScanFile(big)).rejects.toMatchObject({ code: 'too_large', maxMb: 3 });
    await expect(prepareScanFile(big)).rejects.toBeInstanceOf(ScanPrepError);
  });

  it('rejects unsupported types', async () => {
    const txt = new File(['hi'], 'a.txt', { type: 'text/plain' });
    await expect(prepareScanFile(txt)).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('an image the browser cannot decode is never sent (pilot brief: message, 0 requests)', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('cannot decode');
    });
    // Before: a small undecodable JPEG was sent as-is — the OCR then failed on it at the back door.
    const small = new File([new Uint8Array(500)], 'a.jpg', { type: 'image/jpeg' });
    await expect(prepareScanFile(small)).rejects.toMatchObject({ code: 'unsupported_type' });
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'b.jpg', { type: 'image/jpeg' });
    await expect(prepareScanFile(big)).rejects.toBeInstanceOf(ScanPrepError);
    const heic = new File([new Uint8Array(500)], 'c.heic', { type: 'image/heic' });
    await expect(prepareScanFile(heic)).rejects.toMatchObject({ code: 'unsupported_type' });
  });

  it('a big decodable photo is re-encoded as a JPEG within the limit (EXIF orientation requested)', async () => {
    const createImageBitmap = vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage, fillRect, fillStyle: '' };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' });
        }
      },
    );
    const photo = new File([new Uint8Array(6 * 1024 * 1024)], 'IMG_1.HEIC.jpeg', { type: 'image/jpeg' });
    const r = await prepareScanFile(photo);
    expect(createImageBitmap).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 2000, 1500); // white under a transparent PNG
    expect(r.downscaled).toBe(true);
    expect(r.file.type).toBe('image/jpeg');
    expect(r.file.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(r.file.name).toBe('IMG_1.HEIC.jpg');
  });
});

describe('uploadScanFile — the last guard before base64 (wizard upload + PWA queue)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeCanvas(outBytes: number) {
    const drawImage = vi.fn();
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage, fillRect: vi.fn(), fillStyle: '' };
        }
        async convertToBlob() {
          return new Blob([new Uint8Array(outBytes)], { type: 'image/jpeg' });
        }
      },
    );
    return drawImage;
  }

  it('a 6 MB phone JPEG goes out ≤ 3 MB and ≤ 2000 px', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    const drawImage = fakeCanvas(900_000);
    const send = vi.fn(async (_f: File, b64: string) => b64.length);
    const photo = new File([new Uint8Array(6 * 1024 * 1024)], 'IMG.jpg', { type: 'image/jpeg' });
    await uploadScanFile(photo, send);
    expect(send).toHaveBeenCalledTimes(1);
    const [sent] = send.mock.calls[0]!;
    expect(sent.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    const [, , , w, h] = drawImage.mock.calls[0]!;
    expect(Math.max(w as number, h as number)).toBeLessThanOrEqual(MAX_EDGE_PX);
  });

  it('a 5 MB PDF is refused with a coded error and NO request is sent', async () => {
    const send = vi.fn();
    const pdf = new File([new Uint8Array(5 * 1024 * 1024)], 'inv.pdf', { type: 'application/pdf' });
    await expect(uploadScanFile(pdf, send)).rejects.toMatchObject({ code: 'too_large' });
    expect(send).not.toHaveBeenCalled();
  });

  it('an undecodable HEIC-like blob is refused and NO request is sent', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('cannot decode');
    });
    const send = vi.fn();
    for (const f of [
      new File([new Uint8Array(800_000)], 'IMG_0001.HEIC', { type: 'image/heic' }),
      new File([new Uint8Array(800_000)], 'IMG_0002.HEIC', { type: '' }),
    ]) {
      await expect(uploadScanFile(f, send)).rejects.toBeInstanceOf(ScanPrepError);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('an already-small JPEG is sent once, untouched, as base64', async () => {
    const send = vi.fn(async (_f: File, b64: string) => b64);
    const small = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    expect(await uploadScanFile(small, send)).toBe('AQID');
    expect(send.mock.calls[0]![0]).toBe(small);
  });
});
