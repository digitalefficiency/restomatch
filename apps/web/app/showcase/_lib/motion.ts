import { gsap } from 'gsap';

/** The only media query under which showcase GSAP may move anything. */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/**
 * Run GSAP animations only when the visitor allows motion (W1-12 · mkt-15,
 * WCAG 2.3.3). Call it inside `useGSAP` and return its result: the matchMedia
 * re-evaluates live if the OS setting flips, and the returned cleanup reverts
 * it with the component. `reduced` runs instead under prefers-reduced-motion,
 * for state that must still be applied without animating (e.g. an expander's
 * final height).
 */
export function whenMotionOk(animate: () => void, reduced?: () => void): () => void {
  const mm = gsap.matchMedia();
  mm.add({ ok: MOTION_OK, reduce: '(prefers-reduced-motion: reduce)' }, (ctx) => {
    if (ctx.conditions?.ok) animate();
    else if (ctx.conditions?.reduce) reduced?.();
  });
  return () => mm.revert();
}
