// Hebrew→English invoice-line glossary: all category tables concatenated.
// Order is category-grouped; the matcher decides precedence (e.g. longest match).
import type { GlossaryEntry } from './types';
import { PRODUCE } from './produce';
import { DAIRY } from './dairy';
import { PROTEIN } from './protein';
import { PANTRY } from './pantry';
import { BAKERY } from './bakery';
import { BEVERAGES } from './beverages';
import { SUPPLIES } from './supplies';
import { MODIFIERS } from './modifiers';
import { PACKAGING } from './packaging';

export type { GlossaryEntry, GlossaryKind } from './types';
export { PRODUCE, DAIRY, PROTEIN, PANTRY, BAKERY, BEVERAGES, SUPPLIES, MODIFIERS, PACKAGING };

export const ALL_GLOSSARY_ENTRIES: readonly GlossaryEntry[] = [
  ...PRODUCE,
  ...DAIRY,
  ...PROTEIN,
  ...PANTRY,
  ...BAKERY,
  ...BEVERAGES,
  ...SUPPLIES,
  ...MODIFIERS,
  ...PACKAGING,
];
