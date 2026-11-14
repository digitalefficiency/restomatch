// DS2 tier 0: primitives (docs/ux/ds2/DS2-SPEC.md §5.1). PRIVATE to ui-tokens:
// `index.ts` never re-exports this file, and only semantic roles reach components.
//
// DS3 (the clean finish, docs/ux/ds3/SPEC.md §2): the steps below are the clean
// values, keyed by lightness as in DS2. The semantic roles read them, so a value
// lives here once. Steps no role needs are deliberately absent; they are added
// when a role asks for one. Values the clean spec does not name keep their DS2
// value (marked "DS2").

export const ramp = {
  /** Basil: the one primary action of a screen and text links (SPEC §2 --brand). */
  green: { 50: '#E0F9ED', 100: '#D0F3E3', 200: '#ADDEC7', 700: '#00573B', 800: '#00452D' },
  /** Leaf: a counted line and money that came back, T3 (SPEC §2 --ok). */
  leaf: { 50: '#E2FBE9', 100: '#D2F6DD', 200: '#ADE3BF', 500: '#0EA053', 700: '#00713E', 800: '#005D32' },
  /** Tomato: leak and "blocks payment", nothing else (SPEC §2 --leak). */
  red: { 50: '#FFF0EE', 100: '#FBE6E3', 200: '#FACAC5', 500: '#DD2729', 700: '#B7191C', 800: '#991416' },
  /** Turmeric: waits for handling (SPEC §2 --warn); 400 is the dot, 600 its 3:1 ring. */
  amber: { 50: '#FFF6E1', 100: '#FAEDD0', 200: '#F5D79A', 400: '#F2AB19', 600: '#B97500', 700: '#925000', 800: '#794201' },
  /** Sea: selection and keyboard focus (SPEC §2 --info / --focus). */
  blue: { 50: '#ECF4FF', 100: '#E1ECFB', 200: '#BFD5FD', 700: '#2256BB', 800: '#1A469B' },
  /** DS2: data-viz only (price creep, a price rise). */
  orange: { 600: '#B4531A' },
  /** DS2: a categorical data-viz hue only (no money meaning since T3 is green). */
  gold: { 700: '#755C00' },
  teal: { 700: '#007A85' },
  violet: { 700: '#8A4FBF' },
  plum: { 700: '#9C3D7A' },
  /** Paper, steel and ink (D5: no warm paper; the clean neutrals are a hair less green than DS2's). */
  neutral: {
    0: '#FFFFFF',
    // HELD at DS2's value until packages/api/src/__tests__/price-creep-digest.test.ts:124 stops pinning
    // the literal (it reads this role through the e-mail); then SPEC §2's #F8FBF9 (see `held` in semantic.ts).
    25: '#F6F8F7', // canvas
    50: '#F1F5F3', // sunken
    75: '#EBF0ED', // hover
    150: '#E2E8E5', // rule
    200: '#D4DBD8', // line
    // HELD at DS2's value until apps/web/e2e/W1-09.spec.ts:495 stops pinning rgb(122, 139, 130);
    // then SPEC §2's #808984 (see `held` in semantic.ts).
    500: '#7A8B82', // line-strong
    550: '#66756D', // DS2: field-mode border
    600: '#5D6561', // fg3
    650: '#49524E', // fg2
    750: '#3B4B43', // DS2: field-mode secondary text
    800: '#39413E', // neutral bold hover
    950: '#121C17', // ink
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
