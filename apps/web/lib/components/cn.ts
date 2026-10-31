import { extendTailwindMerge } from 'tailwind-merge';
import { radiusRoles, typeRoles, elevation, motion, zIndex } from '@restomatch/ui-tokens';

/**
 * Tailwind-aware class merge (design-system v2). Later classes win, so
 * `<Button className="w-full">` deterministically overrides a component
 * default. The token classes (`text-caption`, `rounded-control`, `shadow-e2`,
 * `duration-medium`, `z-sheet`…) are registered so they are merged as
 * sizes/radii/shadows, not mistaken for colours.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      borderRadius: Object.keys(radiusRoles),
    },
    classGroups: {
      'font-size': [{ text: Object.keys(typeRoles) }],
      shadow: [{ shadow: [...Object.keys(elevation), 'card', 'glow-primary', 'glow-danger', 'glow-gold'] }],
      duration: [{ duration: Object.keys(motion.duration) }],
      ease: [{ ease: Object.keys(motion.easing) }],
      z: [{ z: Object.keys(zIndex) }],
    },
  },
});

/**
 * v2 components (lib/components/{money,form,feedback,overlay,…}, Button,
 * Input, Skeleton, Toast, EmptyState, Spinner) join classes with this.
 */
export function cnMerge(...parts: Array<string | false | null | undefined>): string {
  return twMerge(...parts);
}

/**
 * Plain class joiner (filters falsy parts) — unchanged from v1, so every
 * existing call site renders exactly as before. Pages adopt `cnMerge` (via the
 * v2 components) area by area from wave 2.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
