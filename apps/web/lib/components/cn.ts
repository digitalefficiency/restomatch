import { extendTailwindMerge } from 'tailwind-merge';
import { radiusRoles, typeRoles, elevation, motion, zIndex } from '@restomatch/ui-tokens';

/**
 * Class joiner with Tailwind conflict resolution (design-system: `cn` →
 * `extendTailwindMerge`). Later classes win, so `<Button className="w-full">`
 * deterministically overrides a component default. The token classes
 * (`text-caption`, `rounded-control`, `shadow-e2`, `duration-medium`, `z-sheet`…)
 * are registered so they are merged as sizes/radii/shadows, not mistaken for colours.
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

export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(...parts);
}
