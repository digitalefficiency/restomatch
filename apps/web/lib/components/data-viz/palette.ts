import { dataViz } from '@restomatch/ui-tokens';

/**
 * Data-viz colours as CSS-variable references (tokens.css), for SVG `fill` /
 * `stroke` and inline styles. Never hard-code a hex in a chart.
 */
export const VIZ = {
  categorical: dataViz.categorical.map((_, i) => `rgb(var(--c-viz-${i + 1}))`),
  grid: 'rgb(var(--c-line))',
  axis: 'rgb(var(--c-muted))',
  target: 'rgb(var(--c-muted))',
  leak: 'rgb(var(--c-danger))',
  positive: 'rgb(var(--c-primary))',
  series: 'rgb(var(--c-ink) / 0.7)',
} as const;

/**
 * Sequential "price creep" step (1…5) for a 0…1 intensity, with the text class
 * that passes on it (ink up to step 3, white from step 4). Every cell still
 * prints its value — colour is never the only signal.
 */
export function creepStep(intensity: number): { step: 1 | 2 | 3 | 4 | 5; bg: string; text: string } {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(intensity) ? intensity : 0));
  const step = (Math.min(4, Math.floor(clamped * 5)) + 1) as 1 | 2 | 3 | 4 | 5;
  return { step, bg: `bg-creep-${step}`, text: `text-on-creep-${step}` };
}
