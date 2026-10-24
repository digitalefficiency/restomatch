/**
 * Text encodings the accounting packages import.
 *
 * Hashavshevet reads Windows-1255 (Hebrew "ANSI") text; Priority's text
 * interfaces read "Unicode" text (UTF-16LE with a BOM, what Excel's "Unicode
 * Text" save produces); Rivhit's Excel import reads UTF-8 CSV with a BOM.
 */

let cp1255: Map<string, number> | null = null;

/**
 * Reverse of the platform's own windows-1255 decoder, so the encoder agrees
 * byte-for-byte with what Windows/Hashavshevet decode (no hand-typed table).
 */
function cp1255Table(): Map<string, number> {
  if (cp1255) return cp1255;
  const decoder = new TextDecoder('windows-1255');
  const table = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = decoder.decode(new Uint8Array([b]));
    if (ch !== '�' && !table.has(ch)) table.set(ch, b);
  }
  cp1255 = table;
  return table;
}

/** Encode to Windows-1255. Characters it can't represent become '?'. */
export function encodeWindows1255(text: string): Uint8Array {
  return encodeWindows1255WithReport(text).bytes;
}

/** Windows-1255 bytes plus how many characters had to become '?' (so the UI can warn). */
export function encodeWindows1255WithReport(text: string): { bytes: Uint8Array; replaced: number } {
  const table = cp1255Table();
  const out = new Uint8Array(text.length);
  let n = 0;
  let replaced = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out[n++] = code;
    else {
      const b = table.get(ch);
      if (b === undefined) replaced++;
      out[n++] = b ?? 0x3f;
    }
  }
  return { bytes: out.slice(0, n), replaced };
}

/** UTF-16LE with a byte-order mark. */
export function encodeUtf16leBom(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[2 + i * 2] = unit & 0xff;
    out[3 + i * 2] = unit >> 8;
  }
  return out;
}

/** UTF-8 with a byte-order mark (Excel opens Hebrew CSV correctly with it). */
export function encodeUtf8Bom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(3 + body.length);
  out.set([0xef, 0xbb, 0xbf]);
  out.set(body, 3);
  return out;
}
