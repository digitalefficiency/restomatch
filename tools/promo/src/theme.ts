import { Easing, interpolate } from 'remotion';

// Mirrors packages/ui-tokens/src/index.ts — the dark "command center for money".
// Three accents only: primary (money-green), danger (leak), gold (recovered).
export const C = {
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
} as const;

/** Light stage — mirrors the light ui-tokens (PR #77) for assets that sit on the light landing. */
export const LIGHT = {
  bg: '#F6F8F7',
  bgDeep: '#EAF0EC',
  surface: '#FFFFFF',
  line: '#D3DDD7',
  ink: '#0F1F17',
  muted: '#4A5D53',
  primary: '#066B4A',
  gold: '#8A5300',
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
