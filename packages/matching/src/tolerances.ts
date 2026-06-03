import type { Tolerances } from '@restomatch/types';

/** Sane defaults applied when a restaurant has not configured its own. */
export const DEFAULT_TOLERANCES: Required<Tolerances> = {
  pricePercent: 0.02,
  priceAbsolute: 5,
  qtyPercent: 0.03,
  qtyAbsolute: 1,
  blockPricePercent: 0.1,
};

/**
 * Merge a restaurant's partial tolerance overrides (from
 * `restaurants.settings.tolerances`) over the sane defaults. Undefined/null
 * fields fall back to the default rather than blanking it out.
 */
export function resolveTolerances(
  overrides?: Partial<Tolerances> | null,
): Required<Tolerances> {
  const clean: Partial<Tolerances> = {};
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null) {
        (clean as Record<string, number>)[key] = value as number;
      }
    }
  }
  return { ...DEFAULT_TOLERANCES, ...clean };
}
