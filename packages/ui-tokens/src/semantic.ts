// Semantic colour roles — "Command Center Light v2" (docs/ux/review/lens-design-system.md §3.2).
//
// Components consume ROLES, never raw hex: surfaces, text, the focus colour, six
// status families (each with the same nine roles), money states and data-viz.
// `build.ts` turns these into the CSS variables (apps/web/app/tokens.css) and the
// Tailwind preset; `__tests__/contrast.test.ts` fails any text/background pair
// below 4.6:1 (AA 4.5 + a 0.1 safety margin, a11y-21).

/** Canvas, cards and borders. Values unchanged from v1 — now named by role. */
export const surfaces = {
  canvas: '#F6F8F7', // page background (Tailwind `bg`)
  surface: '#FFFFFF', // cards, tables, bars — solid, never glass on app chrome
  sunken: '#EEF3F0', // inputs at rest, tile wells, T4 panels (Tailwind `surface-2` / `surface-sunken`)
  line: '#D3DDD7', // decorative dividers only (1.39:1)
  lineStrong: '#7A8B82', // control boundaries (≥3:1, WCAG 1.4.11)
  lineField: '#66756D', // field-mode input borders (≥4.5:1, lens-mobile-field §3.6)
} as const;

export const text = {
  ink: '#0F1F17', // primary text and every money figure
  muted: '#4A5D53', // secondary text, labels
  subtle: '#5A6A62', // tertiary / placeholder — banned in field mode
  onBold: '#FFFFFF', // text on any `bg-bold` fill
} as const;

/** R-5: one focus colour, distinct from money-green and danger. 6.24:1 on white. */
export const focus = '#1A5BC7' as const;

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

/** Text on `bgSubtle` ≥5.5:1, white on `bgBold` ≥6.2:1 (contrast test enforces ≥4.6). */
export const status: Record<StatusFamily, FamilyRoles> = {
  primary: { text: '#066B4A', bgBold: '#066B4A', bgBoldHover: '#05583D', bgSubtle: '#E7F3ED', bgSubtleHover: '#D3EADF', borderSubtle: '#A9D3C0', onBold: '#FFFFFF' },
  danger: { text: '#B80F2A', bgBold: '#B80F2A', bgBoldHover: '#990C23', bgSubtle: '#FCECEF', bgSubtleHover: '#F8DADF', borderSubtle: '#EDB3BD', onBold: '#FFFFFF' },
  warn: { text: '#A63D00', bgBold: '#A63D00', bgBoldHover: '#893200', bgSubtle: '#FDF0E7', bgSubtleHover: '#F9E0CF', borderSubtle: '#EBBF9F', onBold: '#FFFFFF' },
  gold: { text: '#755C00', bgBold: '#755C00', bgBoldHover: '#5F4A00', bgSubtle: '#F8F2DD', bgSubtleHover: '#EFE6C3', borderSubtle: '#D9C789', onBold: '#FFFFFF' },
  info: { text: '#1A5BC7', bgBold: '#1A5BC7', bgBoldHover: '#154BA6', bgSubtle: '#EBF2FD', bgSubtleHover: '#D9E6FB', borderSubtle: '#B1CAF1', onBold: '#FFFFFF' },
  neutral: { text: '#4A5D53', bgBold: '#4A5D53', bgBoldHover: '#3B4B43', bgSubtle: '#EEF3F0', bgSubtleHover: '#E2EAE5', borderSubtle: '#D3DDD7', onBold: '#FFFFFF' },
};

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
