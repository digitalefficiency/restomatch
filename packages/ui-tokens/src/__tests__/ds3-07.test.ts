// DS3-07: Google Sans as the active UI face (an owner decision in the form of a pull request).
// Plex stays defined beside it: `ACTIVE_FACE = 'plex'` must give back the train C block byte for byte.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVE_FACE, activeFonts, cssVariables, faces, fallbackFaces, fontFaceCss, fontPreloads, fontRoles, fontUrl, UNICODE_RANGE } from '../index';

const pub = (url: string) => fileURLToPath(new URL(`../../../../apps/web/public${url}`, import.meta.url));
const bytes = (url: string) => statSync(pub(url)).size;
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const KB = 1024;
const gs = faces['google-sans'];

/**
 * sha256 of each file exactly as published in @fontsource-variable/google-sans@5.3.2
 * (npm integrity sha512-fN+fO2Ffm+n2G5K+UK4ynP5WrWT+M/dbBs9HZaYcgAT5evhefJJH2MlGj8yMz+8slQmhjWAqPJyJ1sELkUM4Uw==).
 * A replaced or re-encoded file fails here: record its new source and licence first.
 */
const PUBLISHED_SHA256: Record<string, string> = {
  hebrew: '3bef5cb92e29b517729b747de2f62c130f67753761d17f96055e3de1a5d48693',
  latin: '3f43e613a4176decfb0ab2e4cf68bfcfbebe9eee1a3de080c4115426258fa32f',
  'latin-ext': '2507802626a6cb16e4a7410bbb809380b957333582156a3907431b4fe57afab4',
  cyrillic: '5f178150d24e16e4ea66244c35d1f438fe9cd8646c64c89f8bde249b174cce31',
};

describe('DS3-07 Google Sans', () => {
  it('is the active face, for interface text, numbers and identifiers (D3); D11 unchanged', () => {
    expect(ACTIVE_FACE).toBe('google-sans');
    expect(activeFonts.uiFaces).toBe("'Google Sans', 'Google Sans Fallback'");
    expect(activeFonts.ui).toBe("'Google Sans', 'Google Sans Fallback', -apple-system, BlinkMacSystemFont, system-ui, sans-serif");
    expect(activeFonts.num).toBe('var(--font-ui)');
    expect(activeFonts.id).toBe('var(--font-ui)');
    expect(activeFonts.display).toBe(fontRoles.plex.display);
  });

  it('the number role keeps tabular figures (Google Sans digits are proportional without them)', () => {
    expect(activeFonts.featuresNum).toBe("'tnum' 1, 'lnum' 1");
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

  it('every file is the published one, with the OFL beside it and no Reserved Font Name', () => {
    expect([...gs.subsets].sort()).toEqual(Object.keys(PUBLISHED_SHA256).sort());
    for (const s of gs.subsets) {
      const sha = createHash('sha256').update(readFileSync(pub(fontUrl(gs, s, 400)))).digest('hex');
      expect(sha, s).toBe(PUBLISHED_SHA256[s]);
    }
    const ofl = readFileSync(pub(`${gs.dir}/OFL.txt`), 'utf8');
    expect(ofl).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(ofl).toMatch(/^Copyright 2025 The Google Sans Project Authors/);
    // The header above the licence text names no Reserved Font Name, so subsets keep the name.
    expect(ofl.slice(0, ofl.indexOf('PREAMBLE'))).not.toMatch(/Reserved Font Name/i);
  });

  it('one variable rule per subset (400–700), weight-band fallbacks, and no Plex rule in the block', () => {
    const css = cssVariables();
    for (const s of gs.subsets) {
      expect(css).toContain(
        [
          "  font-family: 'Google Sans';",
          '  font-style: normal;',
          '  font-weight: 400 700;',
          '  font-display: swap;',
          `  src: url('${fontUrl(gs, s, 400)}') format('woff2');`,
          `  unicode-range: ${UNICODE_RANGE[s]};`,
        ].join('\n'),
      );
    }
    expect(css).not.toContain('IBM Plex Sans Hebrew');
    expect(css).toContain("--font-ui: 'Google Sans', 'Google Sans Fallback'");
  });

  it('the fallback: a catch-all per weight band first, then Latin, Hebrew, space and digits faces, every line box the face’s', () => {
    const gsFallbacks = fallbackFaces.filter((f) => f.family === 'Google Sans Fallback');
    const ranges = gsFallbacks.map((f) => ('unicodeRange' in f ? f.unicodeRange : null));
    // CSS checks the last-defined @font-face first for an overlapping range, so the catch-all must come first.
    expect(ranges).toEqual([
      ...Array(4).fill(null),
      ...Array(4).fill(UNICODE_RANGE.latin),
      ...Array(4).fill(UNICODE_RANGE.hebrew),
      ...Array(4).fill('U+0020, U+00A0'),
      ...Array(4).fill('U+0030-0039'),
    ]);
    for (const f of gsFallbacks) {
      const sa = parseFloat(f.sizeAdjust) / 100;
      // ascent and descent overrides are scaled by size-adjust: undo it to get the face's hhea 966 / 286.
      expect(Math.abs((parseFloat(f.ascent) / 100) * sa - 0.966), `${f.weight} ${f.sizeAdjust}`).toBeLessThan(0.0006);
      expect(Math.abs((parseFloat(f.descent) / 100) * sa - 0.286), `${f.weight} ${f.sizeAdjust}`).toBeLessThan(0.0006);
      expect(f.lineGap).toBe('0%');
    }
    const css = fontFaceCss('google-sans');
    expect(css.match(/font-family: 'Google Sans Fallback';/g)).toHaveLength(20);
    expect(css.match(/unicode-range: U\+0030-0039;/g)).toHaveLength(4);
    // Plex keeps its four DS2 bands without a range (the undo).
    expect(fontFaceCss('plex')).not.toMatch(/Fallback';[^}]*unicode-range/);
  });

  it('PERF: hebrew + latin carry all four weights, preloaded, within both budgets', () => {
    const { he, en } = fontPreloads();
    expect(he).toEqual([fontUrl(gs, 'hebrew', 400), fontUrl(gs, 'latin', 400)]);
    expect(en).toEqual([fontUrl(gs, 'latin', 400)]);
    const total = he.reduce((n, href) => n + bytes(href), 0);
    // ≤ 50 KB preloaded and ≤ 100 KB first load (the owner home paints 400, 500, 600 and 700).
    expect(total).toBeLessThanOrEqual(50 * KB);
    expect(gs.weightRange).toEqual([400, 700]);
    for (const w of gs.weights) {
      expect(w).toBeGreaterThanOrEqual(400);
      expect(w).toBeLessThanOrEqual(700);
    }
  });

  it('₪ is drawn by the hebrew file (never latin-ext); Cyrillic is preloaded for ru only', () => {
    expect(UNICODE_RANGE.hebrew).toContain('U+20AA');
    expect(UNICODE_RANGE['latin-ext']).not.toMatch(/U\+20A0-20AB|U\+20AA/);
    expect(fontPreloads().ru).toEqual([fontUrl(gs, 'latin', 400), fontUrl(gs, 'cyrillic', 400)]);
    expect(fontPreloads('plex').ru).toBeUndefined();
  });
});
