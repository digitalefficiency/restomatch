/**
 * The three honest states of a leak figure (rubric A4), pure: no checked
 * invoice yet → `noData` (never a green or red ₪0), nothing leaked → `clean`,
 * else `leak`. A failure is the route's error.tsx ("לא זמין · נסו שוב").
 */
export type LeakState = 'noData' | 'clean' | 'leak';

export function leakStateOf(hero: { matchedInvoiceCount: number; leakIls: number }): LeakState {
  if (hero.matchedInvoiceCount <= 0 && hero.leakIls <= 0) return 'noData';
  return hero.leakIls > 0 ? 'leak' : 'clean';
}
