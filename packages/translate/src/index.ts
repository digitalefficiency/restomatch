export type { GlossaryEntry, GlossaryKind } from './glossary/types';
export { ALL_GLOSSARY_ENTRIES } from './glossary';
export { normalizeHebrew, matchKey, hasHebrew, hebrewRatio } from './normalize';
export { translateUnit, unitLabel, isHebrewUnit } from './units';
export { GlossaryTranslator, tokenize, type GlossaryTranslatorOptions } from './glossaryTranslator';
export {
  ClaudeTranslator,
  DEFAULT_TRANSLATE_MODEL,
  TRANSLATE_SYSTEM_PROMPT,
  type ClaudeTranslatorConfig,
  type MessagesClientLike,
} from './claudeTranslator';
export {
  CompositeTranslator,
  createTranslator,
  defaultGlossary,
  CLAUDE_ERROR_BACKOFF_MS,
  CLAUDE_MISS_TTL_MS,
  MAX_CACHE_ENTRIES,
  type CompositeTranslatorOptions,
  type TranslateManyOptions,
  type Translation,
  type TranslationSource,
} from './composite';
export {
  TARGET_LOCALES,
  TARGET_LANGUAGE_NAMES,
  TargetGlossary,
  defaultTargetGlossary,
  isTargetLocale,
  type TargetLocale,
} from './targets';
export {
  TargetClaudeTranslator,
  TargetTranslator,
  createTargetTranslator,
  targetSystemPrompt,
  type TargetClaudeConfig,
  type TargetTranslation,
  type TargetTranslatorOptions,
} from './targetTranslator';
