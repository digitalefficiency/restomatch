// DS2 web fonts (docs/ux/ds2/DS2-SPEC.md §2.1.1, §5.2; FONTS.md §7; VERDICT §8 phase 2).
//
// `typography.fontFamily` in index.ts is the frozen v1 export that apps/mobile
// consumes (owner decision 12), so the web stacks live here.
//
// Phase 2 (train β, users see it on 24.11, D10):
// - --font-ui → IBM Plex Sans Hebrew (D2), with a metric-matched fallback (G13);
// - --font-id → var(--font-ui): identifiers use Plex Sans, never a mono (D3);
// - --font-display → Frank Ruhl Libre, for the monthly report cover and the
//   print header only, never ₪ and never preloaded (D11).
// Heebo's files and @font-face stay until phase 5 (`ACTIVE_FACE = 'heebo'`).
//
// DS3-07 (an owner decision in the form of a pull request, 14.11.2026): Google Sans
// as a third face, defined the same way as Plex, beside it. The switch is the one
// line `ACTIVE_FACE` below; the undo is `ACTIVE_FACE = 'plex'` and `tokens:css`, which
// regenerates DS3-00's token block byte for byte, with train C's @font-face rules, roles
// and preloads. No test pins the active face, so the undo needs no other edit.
// - Self-hosted Fontsource 5.3.2 subsets (SIL OFL 1.1, no Reserved Font Name; OFL.txt
//   beside them), unmodified except the latin file: it is published with seven Google
//   logo glyphs that its 'liga' and 'calt' put in place of ordinary text ('store_logo.png'
//   drew as "stor" + a logo e + ".png"), so they are removed (GOOGLE_SANS_LATIN_EDIT below).
//   One variable file per script carries every weight 400–700, so Hebrew + Latin is
//   46.6 KiB for all four app weights (Plex: 99.8 KiB), both preloaded.
// - Its default digits are proportional (0.430–0.643 em); with 'tnum' they are 0.600 em
//   in every weight, like Plex's default digits. Its 'tnum' also sets the space and
//   . , : ; to 0.300 em and ₪ % # § + − × ÷ = < > ± ¬ $ € £ ¥ ¢ ¤ to 0.600 em (₪ and %
//   redrawn narrower), so it belongs on figures, never on running text. Figures get it
//   where they carry the number role (`.num`, `tabular-nums`); `featuresNum` is emitted
//   as --font-features-num but nothing reads it yet. Digits rendered without the number
//   role (they were fixed-width only because Plex's are) turn proportional.
// - Cyrillic (ru receivers) is drawn by the family; Arabic, Thai and Ethiopic keep
//   their Noto script fonts (the receiver rules in globals.css put them first).
// - D3 (identifiers in the UI family) and D11 (Frank Ruhl Libre on the report cover
//   only) are unchanged.

import { family } from './primitives';

export type FaceId = 'heebo' | 'plex' | 'google-sans';

/** The one-line switch (DS3-07). Undo: 'plex' (D2, train C). */
export const ACTIVE_FACE: FaceId = 'google-sans';

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

/** Not in primitives' `family` (DS3-00's file): promote it there if DS3-07 lands. */
const GOOGLE_SANS = "'Google Sans'";

export interface FontRoles {
  /** The UI faces without a generic family, for stacks that append script fonts (receiver locales). */
  uiFaces: string;
  ui: string;
  /** Every ₪, quantity, %, count and date. Always the same family as `ui`. */
  num: string;
  /** Invoice, PO, SKU and ח״פ numbers, LTR-isolated. Never money. */
  id: string;
  /** The monthly report cover and its print header. Never ₪, never the app shell. */
  display: string;
  featuresUi: string;
  featuresNum: string;
}

export const fontRoles: Record<FaceId, FontRoles> = {
  heebo: {
    uiFaces: `${family.heebo}, 'Heebo Fallback'`,
    ui: `${family.heebo}, 'Heebo Fallback', "Inter", ${SYSTEM_SANS}`,
    num: 'var(--font-ui)',
    id: `${family.jetbrainsMono}, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`,
    display: 'var(--font-ui)',
    featuresUi: 'normal',
    featuresNum: "'tnum' 1, 'lnum' 1",
  },
  plex: {
    uiFaces: `${family.plexSansHebrew}, 'IBM Plex Sans Hebrew Fallback'`,
    ui: `${family.plexSansHebrew}, 'IBM Plex Sans Hebrew Fallback', ${SYSTEM_SANS}`,
    num: 'var(--font-ui)',
    id: 'var(--font-ui)',
    display: `${family.frankRuhlLibre}, 'Frank Ruhl Libre Fallback', serif`,
    featuresUi: 'normal',
    featuresNum: "'tnum' 1, 'lnum' 1",
  },
  'google-sans': {
    uiFaces: `${GOOGLE_SANS}, 'Google Sans Fallback'`,
    ui: `${GOOGLE_SANS}, 'Google Sans Fallback', ${SYSTEM_SANS}`,
    num: 'var(--font-ui)',
    id: 'var(--font-ui)',
    display: `${family.frankRuhlLibre}, 'Frank Ruhl Libre Fallback', serif`,
    // Running text keeps the face's proportional digits and spacing (as the DS3
    // reference does): its 'tnum' would also widen every space. Figures take 'tnum'.
    featuresUi: 'normal',
    featuresNum: "'tnum' 1, 'lnum' 1",
  },
};

export const activeFonts: FontRoles = fontRoles[ACTIVE_FACE];

// ── Self-hosted faces (Fontsource files, SIL OFL; OFL.txt beside them) ──
// Plex and Frank Ruhl Libre: Fontsource 5.3.0. Google Sans: @fontsource-variable/google-sans 5.3.2.

/**
 * The one change made to a published Google Sans file (OFL 1.1 allows modified versions; the
 * family has no Reserved Font Name and the name table, with its copyright and licence, is kept).
 * The latin file carries 'Google.logo', 'G.logo', 'G.super', 'e.logo', 'g.logo', 'l.logo' and
 * 'o.logo', reached only through 20 ligature rules ('e_logo', 'google_logo', 'super_G_logo' …)
 * that browsers apply by default. The fontTools subsetter drops those seven glyphs and the rules
 * that make them; every other glyph, codepoint, feature, outline, advance and variation delta is
 * the published file's (61,160 shaping comparisons, 4 weights × 11 feature sets, identical).
 * Reproducible: `TTFont(published, recalcTimestamp=False)`, then fontTools.subset with `options`
 * below, glyphs = every glyph but the seven, unicodes = the file's cmap, saved as woff2; with
 * these versions (uharfbuzz serialises GSUB/GPOS) the bytes are the shipped ones.
 * Trademark: the upstream font's name table (google/fonts GoogleSans[GRAD,opsz,wght].ttf, nameID 7)
 * says "“Google” and “Google Sans” are trademarks of Google LLC."; the OFL grants the font, not
 * the marks. Fontsource's subsets, and so these files, keep the family name without that record.
 */
export const GOOGLE_SANS_LATIN_EDIT = {
  published: 'google-sans-latin-wght-normal.woff2, @fontsource-variable/google-sans@5.3.2 (35,968 B)',
  publishedSha256: '3f43e613a4176decfb0ab2e4cf68bfcfbebe9eee1a3de080c4115426258fa32f',
  removedGlyphs: ['Google.logo', 'G.logo', 'G.super', 'e.logo', 'g.logo', 'l.logo', 'o.logo'],
  tools: 'fontTools 4.60.1, brotli 1.2.1, uharfbuzz 0.57.0',
  options: {
    layout_features: ['*'],
    layout_scripts: ['*'],
    layout_closure: false,
    glyph_names: true,
    name_IDs: ['*'],
    name_languages: ['*'],
    name_legacy: true,
    notdef_glyph: true,
    notdef_outline: true,
    hinting: true,
    legacy_kern: true,
    symbol_cmap: true,
    legacy_cmap: true,
    prune_unicode_ranges: false,
    prune_codepage_ranges: false,
    passthrough_tables: true,
    drop_tables: [],
    recalc_timestamp: false,
    flavor: 'woff2',
  },
} as const;

/**
 * Fontsource unicode ranges. Digits live in `latin`, ₪ (U+20AA) in `hebrew`.
 * Fontsource's latin-ext range also lists U+20AA, so every ₪ made the browser
 * fetch a latin-ext file too; ₪ is cut out of latin-ext here (the hebrew file draws it).
 * `cyrillic` is Google Sans only (Plex has no Cyrillic).
 */
export const UNICODE_RANGE = {
  hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20A9, U+20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
} as const;
export type Subset = keyof typeof UNICODE_RANGE;

export interface FaceSet {
  family: string;
  dir: string;
  file: (subset: Subset, weight: number) => string;
  subsets: Subset[];
  /** The app weights the set serves. */
  weights: number[];
  /**
   * A variable face: one file per subset carries every weight in this range, so
   * there is one @font-face per subset (`font-weight: min max`), not one per weight.
   */
  weightRange?: readonly [number, number];
  /** Where a set's files cover a different range than UNICODE_RANGE (a newer Fontsource release). */
  ranges?: Partial<Record<Subset, string>>;
}

/** The unicode-range a set's file for `subset` serves. */
export const rangeOf = (set: FaceSet, subset: Subset): string => set.ranges?.[subset] ?? UNICODE_RANGE[subset];

export const faces: Record<'plex' | 'google-sans' | 'display', FaceSet> = {
  plex: {
    family: 'IBM Plex Sans Hebrew',
    dir: '/fonts/ibm-plex-sans-hebrew',
    file: (s, w) => `ibm-plex-sans-hebrew-${s}-${w}-normal.woff2`,
    subsets: ['hebrew', 'latin', 'latin-ext'],
    // 400 body · 500 id/kbd (D3) · 600 titles/money-row · 700 money-card/hero.
    weights: [400, 500, 600, 700],
  },
  'google-sans': {
    family: 'Google Sans',
    dir: '/fonts/google-sans',
    // The `wght` axis only (opsz 18 and GRAD 0, the family's defaults, are fixed in the files).
    file: (s) => `google-sans-${s}-wght-normal.woff2`,
    // latin last: for a character in two ranges the last rule is tried first, and the preloaded
    // latin file draws ı Œ œ and the combining marks, so they never fetch latin-ext.
    subsets: ['hebrew', 'cyrillic', 'latin-ext', 'latin'],
    weights: [400, 500, 600, 700],
    weightRange: [400, 700],
    // Fontsource 5.3.2's latin-ext range (to U+20C4), with ₪ cut out as above.
    ranges: {
      'latin-ext':
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20A9, U+20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  },
  display: {
    family: 'Frank Ruhl Libre',
    dir: '/fonts/frank-ruhl-libre',
    file: (s, w) => `frank-ruhl-libre-${s}-${w}-normal.woff2`,
    subsets: ['hebrew', 'latin'],
    weights: [600, 700],
  },
};

export const fontUrl = (set: FaceSet, subset: Subset, weight: number): string => `${set.dir}/${set.file(subset, weight)}`;

/**
 * Metric-matched fallbacks (G13; DS2 §2.1.1 rule 4), measured with fontTools on
 * the shipped files: size-adjust = the face's average advance over a sample of
 * digits, ₪, Hebrew, Latin lower and upper case ÷ the fallback's; ascent/descent
 * = the face's hhea metrics (USE_TYPO_METRICS: asc 1025, desc 275, gap 0) ÷ size-adjust.
 *
 * One fallback per weight band: Plex ships a file per weight, and only 400 + 700
 * are preloaded, so 500/600 text is painted in the fallback first. With
 * `font-synthesis: none` a single regular fallback would draw that text too
 * narrow and it would grow when Plex 600 arrives (measured: a wrapping toolbar
 * on /dashboard/leaks shifted, CLS 0.052). So 550+ falls back to Arial Bold.
 * Frank Ruhl 700: asc 957, desc 334; vs Times/Liberation Serif Bold.
 *
 * Google Sans (DS3-07): the same bands, asc 966, desc 286, gap 0 (USE_TYPO_METRICS).
 * One size-adjust per band did not fit both scripts: against Arial, Google Sans's Hebrew
 * letters are 103–110 % wide and its Latin 100–107 %, and with the face held back 3 s the
 * band catch-all alone moved a phone layout by CLS 0.38 when the face swapped in. So each
 * band has two faces, fitted in Chromium on the product's own catalogue strings (537 he,
 * 600 en) drawn in Liberation Sans, Arial's metric twin: the catch-all on the English
 * strings, then a Hebrew face (the hebrew subset's range, defined after the catch-all so
 * it is tried first there) on the Hebrew strings, the catch-all drawing their spaces,
 * digits and punctuation. Median width, fallback ÷ face: 1.000–1.001 in both languages at
 * every weight, 80 % of strings within ±2 % (Plex's: he 1.016–1.035, en 0.980–1.006).
 * Faces for more classes (Latin, the space, the digits) fitted a little closer but cost
 * first paint: each class splits text runs, and 20 faces delayed a throttled phone's
 * Hebrew first paint by 40–90 ms, where the Hebrew face alone cost nothing measurable.
 * With every font held back 3 s (8 routes × he/en × 1440/390), 1 of 32 screen loads moved
 * more than CLS 0.01 when the face swapped in, worst 0.031 (Plex: 3 of 32, worst 0.072).
 * While the fallback shows, ch and ex come from the catch-all (1ch ≈ 0.56 em; the face's
 * is 0.643 em), so nothing that paints before the face may be sized in ch or ex.
 */
const ARIAL = ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"] as const;
const ARIAL_BOLD = ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"] as const;

export const fallbackFaces = [
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '100 449', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '98.65%', ascent: '103.9%', descent: '27.88%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '450 549', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '100.88%', ascent: '101.6%', descent: '27.26%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '550 649', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '97.29%', ascent: '105.36%', descent: '28.27%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '650 900', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '98.63%', ascent: '103.93%', descent: '27.88%', lineGap: '0%' },
  { family: 'Frank Ruhl Libre Fallback', weight: '600 700', local: ["local('Times New Roman Bold')", "local('TimesNewRomanPS-BoldMT')", "local('Liberation Serif Bold')"], sizeAdjust: '103.16%', ascent: '92.77%', descent: '32.38%', lineGap: '0%' },
  // Google Sans: the band catch-all, fitted on the English strings.
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '100.68%', ascent: '95.95%', descent: '28.41%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '104.12%', ascent: '92.78%', descent: '27.47%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '98.18%', ascent: '98.39%', descent: '29.13%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '99.75%', ascent: '96.84%', descent: '28.67%', lineGap: '0%' },
  // Google Sans Hebrew, after the catch-all so it is tried first for its range; fitted on the Hebrew strings.
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '105.51%', ascent: '91.56%', descent: '27.11%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '107.81%', ascent: '89.6%', descent: '26.53%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '101.57%', ascent: '95.11%', descent: '28.16%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '102.75%', ascent: '94.01%', descent: '27.83%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
] as const;

export interface FontPreloads {
  he: string[];
  en: string[];
  /** A receiver locale whose script the UI face draws (Google Sans: Cyrillic). */
  ru?: string[];
}

/**
 * Preloaded files per base locale for a face (default: the active one; rule 2: both subsets for Hebrew money, the
 * two weights above the fold). 500/600, latin-ext and Frank Ruhl load on demand.
 * β budget: ≤50 KB preloaded (Plex 400 + 700 × hebrew + latin = 48.8 KiB).
 * Google Sans: one file per script holds all four weights (hebrew + latin = 46.6 KiB),
 * so nothing paints in a fallback weight once they arrive; ru also preloads Cyrillic.
 * Rule 2 costs Google Sans first paint on a slow phone: Chromium holds the first paint
 * for the preloaded files, and the latin file (35.6 KiB, every weight) arrives last.
 * Measured (Pixel 7, 4× CPU, 1.6 Mbps): Hebrew pages preloading the hebrew file alone
 * painted 236 ms sooner, on a par with Plex, and the latin file swapped in with CLS ≤ 0.0013;
 * the cost is that digits (and so amounts) show in the fallback until it arrives.
 */
export function fontPreloads(face: FaceId = ACTIVE_FACE): FontPreloads {
  if (face === 'heebo') {
    return { he: ['/fonts/heebo/heebo-hebrew-wght.woff2', '/fonts/heebo/heebo-latin-wght.woff2'], en: ['/fonts/heebo/heebo-latin-wght.woff2'] };
  }
  if (face === 'google-sans') {
    const g = faces['google-sans'];
    return {
      he: [fontUrl(g, 'hebrew', 400), fontUrl(g, 'latin', 400)],
      en: [fontUrl(g, 'latin', 400)],
      ru: [fontUrl(g, 'latin', 400), fontUrl(g, 'cyrillic', 400)],
    };
  }
  const p = faces.plex;
  return {
    he: [fontUrl(p, 'hebrew', 400), fontUrl(p, 'latin', 400), fontUrl(p, 'hebrew', 700), fontUrl(p, 'latin', 700)],
    en: [fontUrl(p, 'latin', 400), fontUrl(p, 'latin', 700)],
  };
}

/** The self-hosted sets a face emits: its own files and the display face (D11). Heebo's are hand-written. */
export function faceSetsFor(face: FaceId): FaceSet[] {
  if (face === 'plex') return [faces.plex, faces.display];
  if (face === 'google-sans') return [faces['google-sans'], faces.display];
  return [];
}

/** The @font-face rules for a face (default: the active one) and its fallbacks (generated into globals.css). */
export function fontFaceCss(face: FaceId = ACTIVE_FACE): string {
  const out: string[] = [];
  const rule = (set: FaceSet, s: Subset, weight: string, url: string) =>
    out.push(
      '@font-face {',
      `  font-family: '${set.family}';`,
      '  font-style: normal;',
      `  font-weight: ${weight};`,
      '  font-display: swap;',
      `  src: url('${url}') format('woff2');`,
      `  unicode-range: ${rangeOf(set, s)};`,
      '}',
    );
  const sets = faceSetsFor(face);
  for (const set of sets) {
    if (set.weightRange) {
      const [min, max] = set.weightRange;
      for (const s of set.subsets) rule(set, s, `${min} ${max}`, fontUrl(set, s, min));
    } else {
      for (const w of set.weights) for (const s of set.subsets) rule(set, s, String(w), fontUrl(set, s, w));
    }
  }
  const fallbackFamilies = new Set(sets.map((set) => `${set.family} Fallback`));
  for (const f of fallbackFaces) {
    if (!fallbackFamilies.has(f.family)) continue;
    out.push(
      '@font-face {',
      `  font-family: '${f.family}';`,
      `  font-weight: ${f.weight};`,
      `  src: ${f.local.join(', ')};`,
      `  size-adjust: ${f.sizeAdjust};`,
      `  ascent-override: ${f.ascent};`,
      `  descent-override: ${f.descent};`,
      `  line-gap-override: ${f.lineGap};`,
      ...('unicodeRange' in f ? [`  unicode-range: ${f.unicodeRange};`] : []),
      '}',
    );
  }
  return out.join('\n');
}
