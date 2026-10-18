/**
 * One glossary entry: [hebrew, english, kind?].
 *
 *  - kind 'n' (default): a noun or a complete noun phrase ("חזה עוף" → "chicken breast").
 *  - kind 'a': a modifier/adjective that FOLLOWS the noun in Hebrew but PRECEDES it
 *    in English ("טרי" → "fresh": "חזה עוף טרי" → "Fresh chicken breast").
 *  - kind 'x': a trailing qualifier kept after the noun in English
 *    ("ללא גלוטן" → "gluten-free" is 'a'; "בשמן" → "in oil" is 'x').
 *
 * Hebrew keys are written in plain form; the matcher normalizes gershayim
 * (״ " ”), geresh (׳ ' ’), niqqud, maqaf and whitespace on both sides, so one
 * entry covers `ק״ג`, `ק"ג` and `ק''ג`. Spelling variants that differ in
 * LETTERS (כתיב מלא/חסר, e.g. עגבניה/עגבנייה) need their own entries.
 */
export type GlossaryKind = 'n' | 'a' | 'x';
export type GlossaryEntry = readonly [he: string, en: string, kind?: GlossaryKind];
