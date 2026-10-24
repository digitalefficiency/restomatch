import generated from './rects.generated.json';

/** Focus rects measured from the live DOM by scripts/capture.mjs (units of page width). */
export type U = [number, number, number, number];
const R = generated as Record<string, Record<string, number[]>>;

/** Measured rect for a shot/key, or the hand-measured fallback. */
export const rectFor = (shot: string, key: string, fallback: U): U => (R[shot]?.[key] as U | undefined) ?? fallback;

/** Scroll (units of width) that brings a rect to the middle of a 16:10 screen when it sits below the fold. */
export const autoScroll = (u: U, viewH = 0.625) => (u[3] > viewH - 0.04 ? Math.max(0, (u[1] + u[3]) / 2 - viewH / 2) : 0);

/** Blur strip over the demo login e-mail in a shot's header (measured), or the fallback strip. */
export const emailStrip = (shot: string, fallback: { x: number; y: number; w: number; h: number }) => {
  const u = R[shot]?.email as U | undefined;
  return u ? { x: u[0] - 0.004, y: u[1] - 0.003, w: u[2] - u[0] + 0.008, h: u[3] - u[1] + 0.006 } : fallback;
};
