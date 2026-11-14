/**
 * G-09 test kit: synthetic page images and a tiny "WhatsApp/e-mail" driver
 * over processInboundMessage with the stub provider (no network, no paid OCR).
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * A structurally valid baseline JPEG header (SOF0) padded with COM segments to
 * `size` bytes. pdf-lib's embedJpg reads the SOF dimensions and copies the
 * bytes as a DCT stream — it never decodes, so no real scan data is needed.
 */
export function jpegBytes(tag: string, size = 1_000, w = 800, h = 1_100): Uint8Array {
  const head = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const tail = Buffer.from([0xff, 0xd9]);
  const id = createHash('sha256').update(`jpeg:${tag}`).digest();
  const parts: Buffer[] = [head];
  let len = head.length + tail.length;
  let first = true;
  while (first || len < size) {
    const room = Math.min(65_533, Math.max(size - len - 4, id.length));
    const body = Buffer.alloc(room, 0x20);
    if (first) id.copy(body, 0);
    parts.push(Buffer.from([0xff, 0xfe, ((room + 2) >> 8) & 0xff, (room + 2) & 0xff]), body);
    len += room + 4;
    first = false;
  }
  parts.push(tail);
  return new Uint8Array(Buffer.concat(parts));
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/** A real (decodable) w×h grey PNG whose pixels encode `tag`. */
export function pngBytes(tag: string, w = 4, h = 4): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const seed = createHash('sha256').update(`png:${tag}`).digest();
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = seed[(y * w + x) % seed.length]!;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

export function webpBytes(): Uint8Array {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(24, 4);
  b.write('WEBPVP8 ', 8, 'ascii');
  return new Uint8Array(b);
}
