/**
 * W3-06 · pure rules behind /pricing (no React), shared with the unit tests.
 */

/** Plan-aware CTA: lands on the lead form with the plan in the query (attribution reads it). */
export function planCtaHref(planKey: string): string {
  return `/?plan=${encodeURIComponent(planKey)}#lead`;
}

/**
 * Phone order of the plan cards: the recommended plan first (it reads as the
 * preselected choice), the rest in their ladder order. md+ ignores this.
 */
export function planDisplayOrder(keys: readonly string[], highlightKey: string | undefined): string[] {
  if (!highlightKey || !keys.includes(highlightKey)) return [...keys];
  return [highlightKey, ...keys.filter((k) => k !== highlightKey)];
}
