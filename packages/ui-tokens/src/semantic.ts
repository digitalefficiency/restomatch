// Semantic colour roles — "Command Center Light v2" (docs/ux/review/lens-design-system.md §3.2),
// valued in DS3's clean finish (docs/ux/ds3/SPEC.md §2). Every value is a step of
// `primitives.ts`; DS3 moved values and added a few roles, never a meaning.
//
// Components consume ROLES, never raw hex: surfaces, text, the focus colour, six
// status families (each with the same nine roles), money states and data-viz.
// `build.ts` turns these into the CSS variables (the generated block of apps/web/app/globals.css) and the
// Tailwind preset; `__tests__/contrast.test.ts` fails any text/background pair
// below 4.6:1 (AA 4.5 + a 0.1 safety margin, a11y-21).

import { activeDirection } from './directions';
import { ramp } from './primitives';

/**
 * SPEC §2 values that DS3-00 could not land yet: a test outside the token package pins today's
 * literal. Each is invisible at a glance (ΔL < 1 %), passes every contrast gate either way, and
 * flips with one line in primitives.ts once its owner reads the token instead of the literal.
 */
export const held = {
  canvas: { spec: '#F8FBF9', pinnedBy: 'packages/api/src/__tests__/price-creep-digest.test.ts:124' },
  lineStrong: { spec: '#808984', pinnedBy: 'apps/web/e2e/W1-09.spec.ts:495' },
} as const;

/** Canvas, cards and borders (SPEC §2 paper and steel). */
export const surfaces = {
  canvas: ramp.neutral[25], // page background (Tailwind `bg`)
  surface: ramp.neutral[0], // cards, tables, the side menu, sheets — solid, never glass on app chrome
  sunken: ramp.neutral[50], // wells: inputs at rest, a key cap, a segmented track, a neutral pill (Tailwind `surface-2` / `surface-sunken`)
  line: ramp.neutral[200], // border of a card or a field at rest; decorative (1.41:1)
  lineStrong: ramp.neutral[500], // control boundaries and secondary buttons (≥3:1, WCAG 1.4.11)
  lineField: ramp.neutral[550], // field-mode input borders (≥4.5:1, lens-mobile-field §3.6)
} as const;

export const text = {
  ink: ramp.neutral[950], // primary text and every money figure
  muted: ramp.neutral[650], // secondary text, labels
  subtle: ramp.neutral[600], // tertiary: the ₪ sign, the agorot, placeholders — banned in field mode
  onBold: ramp.neutral[0], // text on any `bg-bold` fill
} as const;

/** R-5: one focus colour, distinct from money-green and danger (SPEC §2 sea). 6.74:1 on white. */
export const focus = ramp.blue[700];

export type StatusFamily = 'primary' | 'danger' | 'warn' | 'gold' | 'info' | 'neutral';

export interface FamilyRoles {
  /** Text, icon and strong border colour; also the bold fill. */
  text: string;
  bgBold: string;
  bgBoldHover: string;
  bgSubtle: string;
  bgSubtleHover: string;
  /** Decorative border on subtle surfaces (not a control boundary). */
  borderSubtle: string;
  onBold: string;
}

/** A family read from one ramp: 700 text and fill, 800 hover, 50 / 100 tint, 200 tint border. */
function fromRamp(r: { 50: string; 100: string; 200: string; 700: string; 800: string }): FamilyRoles {
  return { text: r[700], bgBold: r[700], bgBoldHover: r[800], bgSubtle: r[50], bgSubtleHover: r[100], borderSubtle: r[200], onBold: text.onBold };
}

/**
 * Every text pair ≥5:1, white on every bold fill ≥6:1 (the contrast test gates ≥4.6).
 * `primary` is the brand (basil): the primary action, links, the current page.
 * `gold` is the T3 family — the name is v1's; in the clean finish money that came
 * back is GREEN (leaf, SPEC §2 `--ok`), so the role moved and no call site did.
 */
export const status: Record<StatusFamily, FamilyRoles> = {
  primary: fromRamp(ramp.green),
  danger: fromRamp(ramp.red),
  warn: fromRamp(ramp.amber),
  gold: fromRamp(ramp.leaf),
  info: fromRamp(ramp.blue),
  neutral: { text: text.muted, bgBold: text.muted, bgBoldHover: ramp.neutral[800], bgSubtle: surfaces.sunken, bgSubtleHover: ramp.neutral[75], borderSubtle: surfaces.line, onBold: text.onBold },
};

/**
 * DS3: the solid indicator of a status — a dot, a bar, the fill of a round tick —
 * never text and never a money figure (SPEC §2 `--leak-solid`, `--warn-solid`,
 * `--ok-solid`). Brighter than the family's text colour; each is ≥3:1 on white
 * except warn, whose amber dot carries a 1.5 px `warnRing` (3.75:1, WCAG 1.4.11).
 * Families without an indicator (primary, info) draw with their text colour.
 */
export const indicator = {
  danger: ramp.red[500],
  warn: ramp.amber[400],
  warnRing: ramp.amber[600],
  gold: ramp.leaf[500],
  neutral: text.subtle,
} as const;

export type MoneyState =
  | 'leak'
  | 'atRisk'
  | 'caught'
  | 'claimed'
  | 'credited'
  | 'returned'
  | 'outstanding'
  | 'pending'
  | 'spend'
  | 'zero';

/**
 * A9: one colour per money state, everywhere. `figure` is the text role of the
 * ₪ figure itself (a Tailwind text class family name). Note what is NOT here:
 * money owed back (`outstanding`) and ₪0 (`zero`) never take danger red.
 */
export const moneyStates: Record<MoneyState, { figure: 'ink' | 'muted' | 'gold' | 'primary'; tier: 'T1' | 'T2' | 'T3' | 'T4' | null }> = {
  leak: { figure: 'ink', tier: 'T1' }, // ink figure + danger marker (rail) on the T1 hero only
  atRisk: { figure: 'ink', tier: 'T2' }, // bold StatusChip + ink figure + one primary CTA
  // T3 is green in the clean finish: `gold` is the T3 family, now leaf (SPEC §2 `--ok`).
  // claimed / credited keep `primary` (basil green): moving them changes Money's class,
  // which lib/components/__tests__/ds-foundation.test.ts pins (DS3-01; see the DS3-00 PR).
  caught: { figure: 'gold', tier: 'T3' },
  claimed: { figure: 'primary', tier: 'T3' },
  credited: { figure: 'primary', tier: 'T3' }, // + ✓ icon
  returned: { figure: 'gold', tier: 'T3' },
  outstanding: { figure: 'ink', tier: 'T2' }, // + DeadlineChip (warn ≤7 days, danger only when late)
  pending: { figure: 'muted', tier: 'T4' }, // + clock icon
  spend: { figure: 'ink', tier: null },
  zero: { figure: 'muted', tier: null },
};

/** Data-viz roles (lens-design-system §3.2). */
export const dataViz = {
  /** Categorical series, each ≥3:1 on white; pair hue with a shape or pattern. */
  categorical: ['#066B4A', '#1A5BC7', '#755C00', '#8A4FBF', '#00838F', '#A63D00'],
  /** Sequential "price creep" ramp with the text colour that passes on each step. */
  creep: [
    { bg: '#FDF0E7', text: '#0F1F17' },
    { bg: '#F4CDB0', text: '#0F1F17' },
    { bg: '#E8A67A', text: '#0F1F17' },
    { bg: '#B4531A', text: '#FFFFFF' },
    { bg: '#7A2D00', text: '#FFFFFF' },
  ],
  grid: surfaces.line,
  axis: text.muted,
  target: text.muted, // 1 px dashed
  leak: status.danger.text,
  series: text.ink, // at 70 %
} as const;

// ── DS2 semantic roles (docs/ux/ds2/DS2-SPEC.md §2.2, §5.3) ─────────────────
// Added beside the v1 roles above, which stay as they are until phase 5. Each
// v2 role points at today's value, so adopting a v2 name never moves a pixel.
// Tailwind keys never collide with v1 meanings: `text-primary` is the green
// family, so the v2 text roles are `fg`, `fg-secondary` and `fg-tertiary`.


export const textV2 = {
  primary: text.ink,
  secondary: text.muted,
  tertiary: text.subtle,
  /** C6: field mode's darker secondary (≥8.2:1); tertiary is not allowed there. */
  secondaryField: activeDirection.neutrals.textSecondaryField,
  /** SPEC §2: text links are the brand colour (basil), underlined; blue is selection and focus only. */
  link: status.primary.text,
} as const;

export const surfaceV2 = {
  canvas: surfaces.canvas,
  default: surfaces.surface,
  sunken: surfaces.sunken,
  raised: surfaces.surface,
  overlay: surfaces.surface,
  /** C3 / D9: selection is a UI state, so it is blue (today's info-subtle). */
  selected: status.info.bgSubtle,
  /** DS3: the hover fill of a quiet control or a row (SPEC §2 `--hover`). */
  hover: status.neutral.bgSubtleHover,
} as const;

export const border = {
  subtle: surfaces.line,
  /** Ruled tables (direction A): horizontal hairlines, no zebra. Decorative. */
  rule: activeDirection.neutrals.borderRule,
  control: surfaces.lineStrong,
  field: surfaces.lineField,
  focus,
} as const;

/**
 * C2: buttons read `action`, never a status family. Values mirror today's
 * Button variants (primary / secondary / ghost / danger). `danger` is for
 * destructive verbs only; a navigation CTA is never red (D9).
 */
export const action = {
  primary: { bg: status.primary.bgBold, bgHover: status.primary.bgBoldHover, fg: text.onBold },
  secondary: { border: surfaces.lineStrong, bg: surfaces.surface, bgHover: surfaces.sunken, fg: text.ink },
  quiet: { fg: text.muted, fgHover: text.ink, bgHover: status.neutral.bgSubtleHover },
  danger: { bg: status.danger.bgBold, bgHover: status.danger.bgBoldHover, fg: text.onBold },
} as const;

/** The only routes to a danger/warn rail (T1 hero, T2 rows). */
export const emphasis = {
  t1Rail: status.danger.text,
  t2Rail: status.warn.text,
} as const;

/** C4: figures are never red; danger reaches money only as a marker — in the clean finish the T1 dot (SPEC §2). */
export const moneyMarker = indicator.danger;

/**
 * DS2 §2.2.3. No green, red or orange in the categorical set: those keep their
 * money meanings. Each hue is ≥4.6:1 on white so it also works as a label.
 * `dataViz.categorical` (v1) stays as `viz-1…6` until the charts move (W2-09).
 */
export const dataVizV2 = {
  categorical: [ramp.blue[700], ramp.teal[700], ramp.violet[700], ramp.gold[700], ramp.neutral[650], ramp.plum[700]] as string[],
  up: ramp.orange[600], // a price rise (creep-4)
  down: status.gold.text, // a price drop is T3 good news (green in the clean finish)
  prev: surfaces.lineStrong, // the previous period, thin bar or 1.5 px line
  leak: status.danger.text, // the only danger in a chart
  grid: surfaces.line,
} as const;
