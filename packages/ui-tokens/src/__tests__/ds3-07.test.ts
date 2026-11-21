// DS3-07: Google Sans defined beside Plex (an owner decision in the form of a pull request).
// Nothing here pins the active face, so the undo (`ACTIVE_FACE = 'plex'`, then `tokens:css`) keeps
// every test green; the Plex fixture checks that it gives back train C's @font-face rules, roles and preloads.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_FACE,
  activeFonts,
  cssVariables,
  faces,
  fallbackFaces,
  fontFaceCss,
  fontPreloads,
  fontRoles,
  fontUrl,
  GOOGLE_SANS_LATIN_EDIT,
  rangeOf,
  UNICODE_RANGE,
} from '../index';

const pub = (url: string) => fileURLToPath(new URL(`../../../../apps/web/public${url}`, import.meta.url));
const bytes = (url: string) => statSync(pub(url)).size;
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const KB = 1024;
const gs = faces['google-sans'];

/**
 * sha256 of each shipped file. hebrew, latin-ext and cyrillic are byte for byte the files published in
 * @fontsource-variable/google-sans@5.3.2 (npm integrity sha512-fN+fO2Ffm+n2G5K+UK4ynP5WrWT+M/dbBs9HZaYcgAT5evhefJJH2MlGj8yMz+8slQmhjWAqPJyJ1sELkUM4Uw==).
 * latin is the published latin file (sha256 3f43e613…258fa32f) without its seven logo glyphs
 * (GOOGLE_SANS_LATIN_EDIT). A replaced or re-encoded file fails here: record its source and licence first.
 */
const SHIPPED_SHA256: Record<string, string> = {
  hebrew: '3bef5cb92e29b517729b747de2f62c130f67753761d17f96055e3de1a5d48693',
  latin: 'ce9b5e7feeb75d1e498dee63f6f5621f92ca073051256bf8d2949c308c42cb92',
  'latin-ext': '2507802626a6cb16e4a7410bbb809380b957333582156a3907431b4fe57afab4',
  cyrillic: '5f178150d24e16e4ea66244c35d1f438fe9cd8646c64c89f8bde249b174cce31',
};

/** The decompressed table data of a WOFF2 file: enough to look for glyph names in its 'post' table. */
function woff2TableData(buf: Buffer): Buffer {
  expect(buf.toString('latin1', 0, 4)).toBe('wOF2');
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  let off = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[off++] ?? 0;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };
  for (let i = 0; i < numTables; i++) {
    const flags = buf[off++] ?? 0;
    const tag = flags & 0x3f;
    if (tag === 0x3f) off += 4;
    const version = (flags >> 6) & 3;
    base128();
    // glyf (10) and loca (11) are transformed at version 0, every other table at a non-zero version.
    if (tag === 10 || tag === 11 ? version === 0 : version !== 0) base128();
  }
  return brotliDecompressSync(buf.subarray(off, off + totalCompressedSize));
}

/** Whether a CSS unicode-range list covers a code point (U+XXXX, U+XXXX-YYYY and U+XX?? forms). */
function covers(range: string, cp: number): boolean {
  return range.split(',').some((part) => {
    const m = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
    if (!m?.[1]) throw new Error(`not a unicode-range part: ${part}`);
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'F'), 16);
    return cp >= lo && cp <= hi;
  });
}

describe('DS3-07 Google Sans', () => {
  it('the roles follow the one-line switch; Google Sans keeps numbers and identifiers in the UI face (D3) and D11', () => {
    expect(['plex', 'google-sans']).toContain(ACTIVE_FACE);
    expect(activeFonts).toEqual(fontRoles[ACTIVE_FACE]);
    expect(fontRoles['google-sans']).toEqual({
      uiFaces: "'Google Sans', 'Google Sans Fallback'",
      ui: "'Google Sans', 'Google Sans Fallback', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      num: 'var(--font-ui)',
      id: 'var(--font-ui)',
      display: fontRoles.plex.display,
      featuresUi: 'normal',
      featuresNum: "'tnum' 1, 'lnum' 1",
    });
  });

  it('the generated block carries the active face and no other', () => {
    const css = cssVariables();
    expect(css).toContain(fontFaceCss(ACTIVE_FACE));
    expect(css).toContain(`--font-ui: ${fontRoles[ACTIVE_FACE].ui};`);
    expect(css).not.toContain(ACTIVE_FACE === 'plex' ? "'Google Sans" : "'IBM Plex Sans Hebrew");
  });

  it('the number-role token keeps tabular figures in both faces (nothing reads it yet; the e2e spec checks the digits drawn)', () => {
    for (const face of ['plex', 'google-sans'] as const) expect(fontRoles[face].featuresNum).toBe("'tnum' 1, 'lnum' 1");
    expect(cssVariables()).toContain("--font-features-num: 'tnum' 1, 'lnum' 1;");
  });

  it('the undo: Plex gives back the train C @font-face rules, roles and preloads', () => {
    expect(fontFaceCss('plex')).toBe(fixture('ds2-plex-font-faces.css').trimEnd());
    expect(fontRoles.plex).toEqual({
      uiFaces: "'IBM Plex Sans Hebrew', 'IBM Plex Sans Hebrew Fallback'",
      ui: "'IBM Plex Sans Hebrew', 'IBM Plex Sans Hebrew Fallback', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      num: 'var(--font-ui)',
      id: 'var(--font-ui)',
      display: "'Frank Ruhl Libre', 'Frank Ruhl Libre Fallback', serif",
      featuresUi: 'normal',
      featuresNum: "'tnum' 1, 'lnum' 1",
    });
    const p = (s: string, w: number) => `/fonts/ibm-plex-sans-hebrew/ibm-plex-sans-hebrew-${s}-${w}-normal.woff2`;
    expect(fontPreloads('plex')).toEqual({ he: [p('hebrew', 400), p('latin', 400), p('hebrew', 700), p('latin', 700)], en: [p('latin', 400), p('latin', 700)] });
  });

  it('every file is the published one (latin without its logo glyphs), with the OFL beside them and no Reserved Font Name', () => {
    expect([...gs.subsets].sort()).toEqual(Object.keys(SHIPPED_SHA256).sort());
    for (const s of gs.subsets) {
      const sha = createHash('sha256').update(readFileSync(pub(fontUrl(gs, s, 400)))).digest('hex');
      expect(sha, s).toBe(SHIPPED_SHA256[s]);
    }
    const ofl = readFileSync(pub(`${gs.dir}/OFL.txt`), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(ofl).toMatch(/^Copyright 2025 The Google Sans Project Authors/);
    // The header above the licence text names no Reserved Font Name, so subsets and the edited latin file keep the name.
    expect(ofl.slice(0, ofl.indexOf('PREAMBLE'))).not.toMatch(/Reserved Font Name/i);
  });

  it('no file can put a Google logo in place of ordinary text', () => {
    expect(GOOGLE_SANS_LATIN_EDIT.removedGlyphs).toEqual(['Google.logo', 'G.logo', 'G.super', 'e.logo', 'g.logo', 'l.logo', 'o.logo']);
    expect(GOOGLE_SANS_LATIN_EDIT.publishedSha256).not.toBe(SHIPPED_SHA256.latin);
    for (const s of gs.subsets) {
      const data = woff2TableData(readFileSync(pub(fontUrl(gs, s, 400))));
      for (const glyph of GOOGLE_SANS_LATIN_EDIT.removedGlyphs) expect(data.includes(Buffer.from(glyph, 'latin1')), `${s}: ${glyph}`).toBe(false);
    }
    // The glyph names are there to be found: the latin file's tabular zero is.
    expect(woff2TableData(readFileSync(pub(fontUrl(gs, 'latin', 400)))).includes(Buffer.from('zero.tf', 'latin1'))).toBe(true);
  });

  it('one variable rule per subset (400–700), latin last, on Fontsource 5.3.2’s ranges', () => {
    const css = fontFaceCss('google-sans');
    // For a character in two ranges the last rule is tried first: the preloaded latin file, never latin-ext.
    expect(gs.subsets.at(-1)).toBe('latin');
    for (const s of gs.subsets) {
      expect(css).toContain(
        [
          "  font-family: 'Google Sans';",
          '  font-style: normal;',
          '  font-weight: 400 700;',
          '  font-display: swap;',
          `  src: url('${fontUrl(gs, s, 400)}') format('woff2');`,
          `  unicode-range: ${rangeOf(gs, s)};`,
        ].join('\n'),
      );
    }
    // Fontsource 5.3.2's latin-ext file reaches U+20C4 (it draws U+20C1); Plex keeps the shared range.
    expect(covers(rangeOf(gs, 'latin-ext'), 0x20c1)).toBe(true);
    expect(rangeOf(faces.plex, 'latin-ext')).toBe(UNICODE_RANGE['latin-ext']);
    expect(css).not.toContain('IBM Plex Sans Hebrew');
  });

  it('the fallback: a catch-all per weight band, then a Hebrew face, every line box the face’s', () => {
    const gsFallbacks = fallbackFaces.filter((f) => f.family === 'Google Sans Fallback');
    // CSS tries the last-defined @font-face first for an overlapping range, so the catch-all comes first.
    expect(gsFallbacks.map((f) => ('unicodeRange' in f ? f.unicodeRange : null))).toEqual([...Array(4).fill(null), ...Array(4).fill(UNICODE_RANGE.hebrew)]);
    const bands = ['100 449', '450 549', '550 649', '650 900'];
    expect(gsFallbacks.map((f) => f.weight)).toEqual([...bands, ...bands]);
    for (const f of gsFallbacks) {
      const sa = parseFloat(f.sizeAdjust) / 100;
      // ascent and descent overrides are scaled by size-adjust: undo it to get the face's hhea 966 / 286.
      expect(Math.abs((parseFloat(f.ascent) / 100) * sa - 0.966), `${f.weight} ${f.sizeAdjust}`).toBeLessThan(0.0006);
      expect(Math.abs((parseFloat(f.descent) / 100) * sa - 0.286), `${f.weight} ${f.sizeAdjust}`).toBeLessThan(0.0006);
      expect(f.lineGap).toBe('0%');
      // 550 and up fall back to Arial Bold, as Plex's bands do (font-synthesis: none).
      const bold = f.weight === '550 649' || f.weight === '650 900';
      expect(f.local[0], f.weight).toBe(bold ? "local('Arial Bold')" : "local('Arial')");
    }
    expect(fontFaceCss('google-sans').match(/font-family: 'Google Sans Fallback';/g)).toHaveLength(8);
    // Plex keeps its four DS2 bands without a range (the undo).
    expect(fontFaceCss('plex')).not.toMatch(/Fallback';[^}]*unicode-range/);
  });

  it('PERF: hebrew + latin carry all four weights, preloaded, within both budgets', () => {
    const { he, en } = fontPreloads('google-sans');
    expect(he).toEqual([fontUrl(gs, 'hebrew', 400), fontUrl(gs, 'latin', 400)]);
    expect(en).toEqual([fontUrl(gs, 'latin', 400)]);
    // The two preloaded files are the whole first load of a Hebrew page, every weight 400–700:
    // ≤ 50 KB preloaded and ≤ 100 KB for the four weights.
    const total = he.reduce((n, href) => n + bytes(href), 0);
    expect(total).toBeLessThanOrEqual(50 * KB);
    expect(total).toBeLessThanOrEqual(100 * KB);
    expect(gs.weightRange).toEqual([400, 700]);
    for (const w of gs.weights) {
      expect(w).toBeGreaterThanOrEqual(400);
      expect(w).toBeLessThanOrEqual(700);
    }
    // Whichever face is active, its Hebrew preload stays within the 50 KB budget.
    expect(fontPreloads().he.reduce((n, href) => n + bytes(href), 0)).toBeLessThanOrEqual(50 * KB);
  });

  it('₪, geresh, gershayim and maqaf are drawn by the hebrew file only; Cyrillic is preloaded for ru only', () => {
    for (const cp of [0x20aa, 0x05f3, 0x05f4, 0x05be]) {
      const hex = cp.toString(16);
      expect(covers(rangeOf(gs, 'hebrew'), cp), `hebrew U+${hex}`).toBe(true);
      for (const s of gs.subsets.filter((x) => x !== 'hebrew')) expect(covers(rangeOf(gs, s), cp), `${s} U+${hex}`).toBe(false);
    }
    expect(covers(UNICODE_RANGE['latin-ext'], 0x20aa)).toBe(false);
    expect(fontPreloads('google-sans').ru).toEqual([fontUrl(gs, 'latin', 400), fontUrl(gs, 'cyrillic', 400)]);
    expect(fontPreloads('plex').ru).toBeUndefined();
  });
});
