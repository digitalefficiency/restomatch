// DS2 tier 0: primitives (docs/ux/ds2/DS2-SPEC.md §5.1). PRIVATE to ui-tokens:
// `index.ts` never re-exports this file, and only semantic roles reach components.
//
// The colour steps are today's anchors, re-keyed by lightness. They are the
// exact values the v1 roles already use, plus the few that DS2 direction A adds
// (border.rule, field secondary text, the v2 categorical set). Steps no role
// needs yet are deliberately absent; they are added when a role asks for one.

export const ramp = {
  green: { 50: '#E7F3ED', 100: '#D3EADF', 200: '#A9D3C0', 700: '#066B4A', 800: '#05583D' },
  red: { 50: '#FCECEF', 100: '#F8DADF', 200: '#EDB3BD', 700: '#B80F2A', 800: '#990C23' },
  orange: { 50: '#FDF0E7', 100: '#F9E0CF', 200: '#EBBF9F', 600: '#B4531A', 700: '#A63D00', 800: '#893200' },
  gold: { 50: '#F8F2DD', 100: '#EFE6C3', 200: '#D9C789', 700: '#755C00', 800: '#5F4A00' },
  blue: { 50: '#EBF2FD', 100: '#D9E6FB', 200: '#B1CAF1', 700: '#1A5BC7', 800: '#154BA6' },
  teal: { 700: '#007A85' },
  violet: { 700: '#8A4FBF' },
  plum: { 700: '#9C3D7A' },
  /** Direction A keeps today's green-tinted grey (D5: no warm paper). */
  neutral: {
    0: '#FFFFFF',
    25: '#F6F8F7',
    50: '#EEF3F0',
    100: '#E2EAE5',
    150: '#E4EBE7',
    200: '#D3DDD7',
    500: '#7A8B82',
    550: '#66756D',
    600: '#5A6A62',
    650: '#4A5D53',
    750: '#3B4B43',
    950: '#0F1F17',
  },
} as const;

/** Base 4 px; 2 only inside chips, icons and badges (DS2 §2.3). */
export const space = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

/** Raw radius values in px (DS2 §2.4; D6 sets card 12 · control 8 · overlay 16). */
export const radiusPx = { xs: 4, control: 8, card: 12, overlay: 16, marketing: 24, pill: 9999 } as const;

/** App weights (DS2 §2.1.2 rule 4). Plex ships 100–700, so the hero is 700 in A. */
export const weight = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** Font families by name. A direction picks from these (directions.ts). */
export const family = {
  heebo: "'Heebo'",
  plexSansHebrew: "'IBM Plex Sans Hebrew'",
  frankRuhlLibre: "'Frank Ruhl Libre'",
  jetbrainsMono: "'JetBrains Mono'",
} as const;
