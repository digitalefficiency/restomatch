import { Easing, interpolate } from 'remotion';

// The film's palette. Three accents only: primary (money-green), danger (leak), gold (recovered).
// `C` is the ACTIVE stage palette — setStage() switches it between the light identity (default,
// packages/ui-tokens after PR #77) and the original dark "command center" (DARK).
export const DARK = {
  bg: '#0E1512',
  bgDeep: '#08100C',
  surface: '#16201B',
  surface2: '#1C2A23',
  line: '#2A3A31',
  ink: '#ECF5EF',
  muted: '#9DB2A6',
  subtle: '#6B8478',
  primary: '#22D39A',
  onPrimary: '#07120D',
  gold: '#E0B341',
  danger: '#FF5C7A',
  paper: '#F4F1E8',
  paperInk: '#22261F',
};

const LIGHT_STAGE: typeof DARK = {
  bg: '#F6F8F7',
  bgDeep: '#E9EFEB',
  surface: '#FFFFFF',
  surface2: '#EEF3F0',
  line: '#D3DDD7',
  ink: '#0F1F17',
  muted: '#4A5D53',
  subtle: '#6B7C73',
  primary: '#066B4A',
  onPrimary: '#FFFFFF',
  gold: '#755C00',
  danger: '#B80F2A',
  paper: '#FFFFFF',
  paperInk: '#22261F',
};

export const C: typeof DARK = { ...LIGHT_STAGE };
let lightStage = true;
/** Pick the stage before rendering (called from the compositions with their `light` prop). */
export const setStage = (light: boolean) => {
  lightStage = light;
  Object.assign(C, light ? LIGHT_STAGE : DARK);
};
export const isLight = () => lightStage;

/** Light stage — mirrors the light ui-tokens (PR #77) for assets that sit on the light landing. */
export const LIGHT = {
  bg: '#F6F8F7',
  bgDeep: '#EAF0EC',
  surface: '#FFFFFF',
  line: '#D3DDD7',
  ink: '#0F1F17',
  muted: '#4A5D53',
  primary: '#066B4A',
  gold: '#755C00',
  danger: '#B80F2A',
} as const;

export const FONT = {
  sans: '"Heebo", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Heebo", monospace',
};

export const FPS = 30;

// ONE easing family for the whole film (expo-style cubic-béziers).
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1); // entrances, settles
export const EASE_IN = Easing.bezier(0.7, 0, 0.84, 0); // exits
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1); // camera moves

/** 0→1 progress between two frames with the house easing (clamped). */
export const prog = (frame: number, from: number, to: number, ease = EASE_OUT) =>
  interpolate(frame, [from, to], [0, 1], {
    easing: ease,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Whole-shekel figure as the landing copy writes it ("₪3,900") — render inside an LTR isolate. */
export const ils = (n: number) => `₪${Math.round(n).toLocaleString('en-US')}`;
