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
// The undo is `ACTIVE_FACE = 'heebo'`: Heebo's files and @font-face stay until phase 5.

import { family } from './primitives';

export type FaceId = 'heebo' | 'plex';

export const ACTIVE_FACE: FaceId = 'plex';

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

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
};

export const activeFonts: FontRoles = fontRoles[ACTIVE_FACE];

// ── Self-hosted faces (Fontsource 5.3.0 files, SIL OFL; OFL.txt beside them) ──

/**
 * Fontsource unicode ranges. Digits live in `latin`, ₪ (U+20AA) in `hebrew`.
 * Fontsource's latin-ext range also lists U+20AA, so every ₪ made the browser
 * fetch a latin-ext file too; ₪ is cut out of latin-ext here (the hebrew file draws it).
 */
export const UNICODE_RANGE = {
  hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20A9, U+20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
} as const;
export type Subset = keyof typeof UNICODE_RANGE;

export interface FaceSet {
  family: string;
  dir: string;
  file: (subset: Subset, weight: number) => string;
  subsets: Subset[];
  weights: number[];
}

export const faces: Record<'plex' | 'display', FaceSet> = {
  plex: {
    family: 'IBM Plex Sans Hebrew',
    dir: '/fonts/ibm-plex-sans-hebrew',
    file: (s, w) => `ibm-plex-sans-hebrew-${s}-${w}-normal.woff2`,
    subsets: ['hebrew', 'latin', 'latin-ext'],
    // 400 body · 500 id/kbd (D3) · 600 titles/money-row · 700 money-card/hero.
    weights: [400, 500, 600, 700],
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
 */
export const fallbackFaces = [
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '100 449', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '98.65%', ascent: '103.9%', descent: '27.88%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '450 549', local: ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')"], sizeAdjust: '100.88%', ascent: '101.6%', descent: '27.26%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '550 649', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '97.29%', ascent: '105.36%', descent: '28.27%', lineGap: '0%' },
  { family: 'IBM Plex Sans Hebrew Fallback', weight: '650 900', local: ["local('Arial Bold')", "local('Arial-BoldMT')", "local('Liberation Sans Bold')"], sizeAdjust: '98.63%', ascent: '103.93%', descent: '27.88%', lineGap: '0%' },
  { family: 'Frank Ruhl Libre Fallback', weight: '600 700', local: ["local('Times New Roman Bold')", "local('TimesNewRomanPS-BoldMT')", "local('Liberation Serif Bold')"], sizeAdjust: '103.16%', ascent: '92.77%', descent: '32.38%', lineGap: '0%' },
] as const;

/**
 * Preloaded files per base locale (rule 2: both subsets for Hebrew money, the
 * two weights above the fold). 500/600, latin-ext and Frank Ruhl load on demand.
 * β budget: ≤50 KB preloaded (Plex 400 + 700 × hebrew + latin = 49.1 KiB).
 */
export function fontPreloads(): { he: string[]; en: string[] } {
  if (ACTIVE_FACE === 'heebo') {
    return { he: ['/fonts/heebo/heebo-hebrew-wght.woff2', '/fonts/heebo/heebo-latin-wght.woff2'], en: ['/fonts/heebo/heebo-latin-wght.woff2'] };
  }
  const p = faces.plex;
  return {
    he: [fontUrl(p, 'hebrew', 400), fontUrl(p, 'latin', 400), fontUrl(p, 'hebrew', 700), fontUrl(p, 'latin', 700)],
    en: [fontUrl(p, 'latin', 400), fontUrl(p, 'latin', 700)],
  };
}

/** The @font-face rules for the DS2 faces and their fallbacks (generated into globals.css). */
export function fontFaceCss(): string {
  const out: string[] = [];
  for (const set of [faces.plex, faces.display]) {
    for (const w of set.weights) {
      for (const s of set.subsets) {
        out.push(
          '@font-face {',
          `  font-family: '${set.family}';`,
          '  font-style: normal;',
          `  font-weight: ${w};`,
          '  font-display: swap;',
          `  src: url('${fontUrl(set, s, w)}') format('woff2');`,
          `  unicode-range: ${UNICODE_RANGE[s]};`,
          '}',
        );
      }
    }
  }
  for (const f of fallbackFaces) {
    out.push(
      '@font-face {',
      `  font-family: '${f.family}';`,
      `  font-weight: ${f.weight};`,
      `  src: ${f.local.join(', ')};`,
      `  size-adjust: ${f.sizeAdjust};`,
      `  ascent-override: ${f.ascent};`,
      `  descent-override: ${f.descent};`,
      `  line-gap-override: ${f.lineGap};`,
      '}',
    );
  }
  return out.join('\n');
}
