import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, prepareScanFile, ScanPrepError, targetSize } from '../scanPrep';

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

  it('an image the browser cannot decode is sent as-is if it fits, else too_large', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('cannot decode');
    });
    const small = new File([new Uint8Array(500)], 'a.jpg', { type: 'image/jpeg' });
    expect((await prepareScanFile(small)).file).toBe(small);
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'b.jpg', { type: 'image/jpeg' });
    await expect(prepareScanFile(big)).rejects.toMatchObject({ code: 'too_large' });
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
