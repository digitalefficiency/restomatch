import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OcrExtractionError } from '../errors';
import { detectImageMime, mediaTypeFromUrl, parseJsonFromText, resolveImage } from '../providers/_anthropic';

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(16)]);

describe('detectImageMime', () => {
  it.each(['heic', 'heix', 'mif1', 'msf1'])('HEIC/HEIF brand %s → unsupported_format', (brand) => {
    expect(() => detectImageMime(ftyp(brand))).toThrow(OcrExtractionError);
    try {
      detectImageMime(ftyp(brand));
    } catch (e) {
      expect(e).toMatchObject({ code: 'unsupported_format', reviewable: true });
    }
  });

  it('unrecognised bytes are no longer labelled image/jpeg', () => {
    expect(() => detectImageMime(Buffer.from('hello world, not an image'))).toThrow(/unsupported_format/);
  });

  it('still recognises PDF / PNG / JPEG / WEBP / GIF', () => {
    expect(detectImageMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe('image/png');
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(detectImageMime(Buffer.from('GIF89a'))).toBe('image/gif');
  });

  it('a .heic URL → unsupported_format; a base64 HEIC string too', async () => {
    expect(() => mediaTypeFromUrl('https://x.test/scan.HEIC?token=abc')).toThrow(/unsupported_format/);
    await expect(resolveImage(ftyp('heic').toString('base64'), true)).rejects.toMatchObject({ code: 'unsupported_format' });
  });
});

describe('error text carries no invoice content and no URL', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.statusCode = 403;
      res.end('denied');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('a failed download names the status, not the signed URL', async () => {
    const url = `${base}/restaurant-1/scan.jpg?token=SECRET-SIGNATURE`;
    const err = await resolveImage(url, true).catch((e) => e);
    expect(err).toMatchObject({ code: 'fetch_failed' });
    expect(String(err.message)).toContain('403');
    expect(String(err.message)).not.toMatch(/SECRET|token|restaurant-1|127\.0\.0\.1/);
  });

  it('unparseable model output does not echo the text', () => {
    for (const text of ['ספק: ירקני אבי 054-1234567', '{"supplier": {"name": "ירקני אבי"', '{"a": 1,,}']) {
      const err = (() => {
        try {
          parseJsonFromText(text);
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err).toBeInstanceOf(OcrExtractionError);
      expect(String(err!.message)).not.toMatch(/ירקני|054/);
    }
  });
});
