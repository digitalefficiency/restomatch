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
// line `ACTIVE_FACE` below; the undo is `ACTIVE_FACE = 'plex'`, which regenerates
// the train C token block byte for byte (src/__tests__/ds3-07.test.ts holds that).
// - Self-hosted Fontsource 5.3.2 subsets (SIL OFL, no Reserved Font Name; OFL.txt
//   beside them). One variable file per script carries every weight 400–700, so
//   Hebrew + Latin is 47.0 KiB for all four app weights (Plex: 99.8 KiB), both preloaded.
// - Its default digits are proportional; with 'tnum' they are 0.600 em in every
//   weight, like Plex's default digits. Its 'tnum' also sets ₪ , . : ; and the space
//   to tabular widths, so it belongs on figures, never on running text. Figures get it
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
}

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
    subsets: ['hebrew', 'latin', 'latin-ext', 'cyrillic'],
    weights: [400, 500, 600, 700],
    weightRange: [400, 700],
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
 * Google Sans (DS3-07): the same bands, asc 966, desc 286, gap 0 (USE_TYPO_METRICS),
 * measured against Liberation Sans (Arial's metrics) on the variable file instanced at
 * each band's weight. One size-adjust per band did not fit: against Arial, Google Sans's
 * Hebrew letters are 103–110 % wide, its Latin 100–107 %, its space 84 % and its
 * digits 98–108 %, and with the face held back the fallback moved phone layouts by up
 * to CLS 0.38 when it swapped in. So within each band a face per character class
 * (Latin, Hebrew, space, digits at the face's own proportional width), each weighted by
 * how often the product's own he/en message strings use each character, overrides the
 * DS2-method catch-all. On 537 Hebrew and 600 English catalogue strings the fallback is
 * within 0.2–0.6 % of the face at every weight (catch-all alone: −3.4 to +2.3 %); with
 * the face held back 3 s, 1 of 32 screen loads moved more than 0.01 (Plex: 3 of 32).
 */
const ARIAL = ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"] as const;
const ARIAL_BOLD = ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"] as const;
/** The space and no-break space (Google Sans: 84 % of Arial's) and the digits (its own, proportional: 98–104 %). */
const FALLBACK_SPACE = 'U+0020, U+00A0';
const FALLBACK_DIGITS = 'U+0030-0039';

export const fallbackFaces = [
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '100 449', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '98.65%', ascent: '103.9%', descent: '27.88%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '450 549', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '100.88%', ascent: '101.6%', descent: '27.26%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '550 649', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '97.29%', ascent: '105.36%', descent: '28.27%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '650 900', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '98.63%', ascent: '103.93%', descent: '27.88%', lineGap: '0%' },
  { family: 'Frank Ruhl Libre Fallback', weight: '600 700', local: ["local('Times New Roman Bold')", "local('TimesNewRomanPS-BoldMT')", "local('Liberation Serif Bold')"], sizeAdjust: '103.16%', ascent: '92.77%', descent: '32.38%', lineGap: '0%' },
  // Google Sans, every other character (the DS2 method: one size-adjust per band).
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '101.33%', ascent: '95.33%', descent: '28.22%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '104.3%', ascent: '92.62%', descent: '27.42%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '100.41%', ascent: '96.21%', descent: '28.48%', lineGap: '0%' },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '101.86%', ascent: '94.84%', descent: '28.08%', lineGap: '0%' },
  // Google Sans per character class, after the catch-all so each wins for its range.
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '102.99%', ascent: '93.8%', descent: '27.77%', lineGap: '0%', unicodeRange: UNICODE_RANGE.latin },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '106.66%', ascent: '90.57%', descent: '26.81%', lineGap: '0%', unicodeRange: UNICODE_RANGE.latin },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '99.95%', ascent: '96.65%', descent: '28.61%', lineGap: '0%', unicodeRange: UNICODE_RANGE.latin },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '101.69%', ascent: '94.99%', descent: '28.12%', lineGap: '0%', unicodeRange: UNICODE_RANGE.latin },
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '107.28%', ascent: '90.04%', descent: '26.66%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '109.96%', ascent: '87.85%', descent: '26.01%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '102.9%', ascent: '93.88%', descent: '27.79%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '104.18%', ascent: '92.72%', descent: '27.45%', lineGap: '0%', unicodeRange: UNICODE_RANGE.hebrew },
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '83.5%', ascent: '115.69%', descent: '34.25%', lineGap: '0%', unicodeRange: FALLBACK_SPACE },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '83.86%', ascent: '115.19%', descent: '34.1%', lineGap: '0%', unicodeRange: FALLBACK_SPACE },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '83.86%', ascent: '115.19%', descent: '34.1%', lineGap: '0%', unicodeRange: FALLBACK_SPACE },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '84.22%', ascent: '114.7%', descent: '33.96%', lineGap: '0%', unicodeRange: FALLBACK_SPACE },
  { family: 'Google Sans Fallback', weight: '100 449', local: ARIAL, sizeAdjust: '98.3%', ascent: '98.27%', descent: '29.09%', lineGap: '0%', unicodeRange: FALLBACK_DIGITS },
  { family: 'Google Sans Fallback', weight: '450 549', local: ARIAL, sizeAdjust: '101.05%', ascent: '95.6%', descent: '28.3%', lineGap: '0%', unicodeRange: FALLBACK_DIGITS },
  { family: 'Google Sans Fallback', weight: '550 649', local: ARIAL_BOLD, sizeAdjust: '102.44%', ascent: '94.3%', descent: '27.92%', lineGap: '0%', unicodeRange: FALLBACK_DIGITS },
  { family: 'Google Sans Fallback', weight: '650 900', local: ARIAL_BOLD, sizeAdjust: '103.86%', ascent: '93.01%', descent: '27.54%', lineGap: '0%', unicodeRange: FALLBACK_DIGITS },
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
 * β budget: ≤50 KB preloaded (Plex 400 + 700 × hebrew + latin = 49.1 KiB).
 * Google Sans: one file per script holds all four weights (hebrew + latin = 47.0 KiB),
 * so nothing paints in a fallback weight once they arrive; ru also preloads Cyrillic.
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
      `  unicode-range: ${UNICODE_RANGE[s]};`,
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
