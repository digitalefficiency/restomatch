import type { GlossaryEntry, GlossaryKind } from './glossary/types';
import { hasHebrew, matchKey, normalizeHebrew } from './normalize';
import { isHebrewUnit, translateUnit } from './units';

/**
 * Offline, deterministic Hebrew → English for restaurant-supply line items.
 *
 *   "חזה עוף טרי 2.5 ק״ג"   → "Fresh chicken breast 2.5 kg"
 *   "ארגז עגבניות שרי"      → "Case of cherry tomatoes"
 *   "שמן זית Yad Mordechai 1 ל׳" → "Olive oil Yad Mordechai 1 L"
 *
 * Algorithm: tokenize (numbers / sizes / Latin brand text / Hebrew words) →
 * greedy longest-phrase match against the glossary (phrases beat tokens) →
 * re-order each segment into English grocery order: modifiers first (Hebrew
 * adjectives follow the noun), nouns in reverse (Hebrew construct state puts
 * the head first: "מיץ תפוזים" = "orange juice"), trailing qualifiers, then the
 * preserved literals (sizes, %, brand text) in their original order.
 *
 * Confidence rule: if ANY Hebrew word stays unknown the result is null — a
 * half-translated name is worse for a receiver than the Hebrew original plus a
 * Claude translation later.
 */

const MAX_PHRASE = 5;

/** Construct-state "of" heads: "ארגז עגבניות" → "case of tomatoes". */
const OF_HEADS = new Set([
  'case', 'carton', 'pack', 'sack', 'bag', 'bottle', 'can', 'jar', 'bucket', 'tray', 'package',
  'box', 'tin', 'roll', 'bunch', 'container', 'jerrycan', 'barrel', 'keg', 'dozen', 'pair', 'pallet',
  'crate', 'packet', 'sleeve', 'block', 'loaf', 'head',
]);

/** Function words dropped from the English ("of", "the"…). */
const SKIP = new Set(['של', 'את']);

interface Lexeme {
  en: string;
  kind: GlossaryKind;
}

type Item =
  | { t: 'word'; en: string; kind: GlossaryKind; and?: boolean }
  | { t: 'lit'; text: string }
  | { t: 'sep'; text: string };

type RawToken = { t: 'he' | 'lit' | 'sep'; text: string };

export interface GlossaryTranslatorOptions {
  /** Extra / override entries (e.g. a restaurant's own catalog vocabulary). */
  extra?: readonly GlossaryEntry[];
}

export class GlossaryTranslator {
  private readonly lexicon = new Map<string, Lexeme>();
  private readonly maxPhrase: number;

  constructor(entries: readonly GlossaryEntry[], opts: GlossaryTranslatorOptions = {}) {
    let longest = 1;
    for (const [he, en, kind] of [...entries, ...(opts.extra ?? [])]) {
      const key = matchKey(he);
      if (!key) continue;
      this.lexicon.set(key, { en: en.trim(), kind: kind ?? 'n' });
      longest = Math.max(longest, key.split(' ').length);
    }
    this.maxPhrase = Math.min(MAX_PHRASE, longest);
  }

  get size(): number {
    return this.lexicon.size;
  }

  /** Exact dictionary lookup for one word/phrase (no composition). */
  lookup(he: string): string | null {
    return this.lexicon.get(matchKey(he))?.en ?? null;
  }

  /**
   * Translate one item name. Returns the English text, the input itself when it
   * contains no Hebrew (already readable), or null when not confident.
   */
  translate(text: string | null | undefined): string | null {
    if (text == null) return null;
    const normalized = normalizeHebrew(text);
    if (normalized === '') return null;
    if (!hasHebrew(normalized)) return normalized;

    const items = this.toItems(tokenize(normalized));
    if (!items) return null;
    const out = render(items);
    return out ? capitalize(out) : null;
  }

  private toItems(tokens: RawToken[]): Item[] | null {
    const items: Item[] = [];
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      if (tok.t !== 'he') {
        items.push(tok.t === 'sep' ? { t: 'sep', text: tok.text } : { t: 'lit', text: tok.text });
        i += 1;
        continue;
      }

      // A Hebrew unit directly after a number is a size ("1 ק״ג" → "1 kg").
      const prev = items[items.length - 1];
      if (prev?.t === 'lit' && /\d$/.test(prev.text) && isHebrewUnit(tok.text)) {
        prev.text = `${prev.text} ${translateUnit(tok.text)}`;
        i += 1;
        continue;
      }

      // Greedy longest phrase over consecutive Hebrew words.
      let matched = false;
      for (let len = Math.min(this.maxPhrase, tokens.length - i); len >= 1; len -= 1) {
        const span = tokens.slice(i, i + len);
        if (span.some((s) => s.t !== 'he')) continue;
        const lex = this.lexicon.get(matchKey(span.map((s) => s.text).join(' ')));
        if (lex) {
          items.push({ t: 'word', en: lex.en, kind: lex.kind });
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      const key = matchKey(tok.text);
      if (SKIP.has(key)) {
        i += 1;
        continue;
      }
      // Prefix ו ("and") / ה ("the") on an otherwise-known word.
      if (key.length > 2 && (key.startsWith('ו') || key.startsWith('ה'))) {
        const lex = this.lexicon.get(key.slice(1));
        if (lex) {
          items.push({ t: 'word', en: lex.en, kind: lex.kind, and: key.startsWith('ו') });
          i += 1;
          continue;
        }
      }
      return null; // unknown Hebrew word → not confident
    }
    return items;
  }
}

/** Split into Hebrew words, literals (numbers, sizes, %, Latin) and separators. */
export function tokenize(text: string): RawToken[] {
  const out: RawToken[] = [];
  // Separate digits glued to Hebrew ("500גר" / "גר500") and %3 → 3%.
  const spaced = text
    .replace(/%(\d+(?:[.,]\d+)?)/g, '$1%')
    .replace(/(\d)([א-ת])/g, '$1 $2')
    .replace(/([א-ת"'])(\d)/g, '$1 $2');
  const re = /([,/()+;|])|([^\s,/()+;|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spaced)) !== null) {
    if (m[1]) {
      out.push({ t: 'sep', text: m[1] });
      continue;
    }
    const word = m[2]!;
    // Hyphen between Hebrew words is a word joiner ("חסה-אייסברג").
    if (hasHebrew(word) && word.includes('-')) {
      for (const part of word.split('-').filter(Boolean)) {
        out.push({ t: hasHebrew(part) ? 'he' : 'lit', text: part });
      }
      continue;
    }
    out.push({ t: hasHebrew(word) ? 'he' : 'lit', text: word });
  }
  return out;
}

function render(items: Item[]): string {
  const segments: string[] = [];
  let current: Item[] = [];
  const flush = (sep?: string) => {
    const s = renderSegment(current);
    if (s) segments.push(s);
    if (sep) segments.push(sep);
    current = [];
  };
  for (const item of items) {
    if (item.t === 'sep') flush(item.text);
    else current.push(item);
  }
  flush();
  return segments
    .join(' ')
    .replace(/\s+([,;)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSegment(items: Item[]): string {
  // Split on "and"-prefixed words: "מלח ופלפל" → "salt and pepper".
  const groups: Item[][] = [[]];
  for (const it of items) {
    if (it.t === 'word' && it.and) groups.push([]);
    groups[groups.length - 1]!.push(it);
  }
  return groups
    .map(renderGroup)
    .filter(Boolean)
    .join(' and ');
}

function renderGroup(items: Item[]): string {
  const adjectives: string[] = [];
  const nouns: string[] = [];
  const trailing: string[] = [];
  const literals: string[] = [];
  for (const it of items) {
    if (it.t === 'lit') literals.push(it.text);
    else if (it.t === 'word') {
      if (it.kind === 'a') adjectives.push(it.en);
      else if (it.kind === 'x') trailing.push(it.en);
      else nouns.push(it.en);
    }
  }

  let head = '';
  if (nouns.length > 0) {
    const first = nouns[0]!;
    if (nouns.length > 1 && OF_HEADS.has(first.toLowerCase())) {
      // "ארגז עגבניות שרי" → "case of cherry tomatoes"
      const rest = [...adjectives].reverse().concat([...nouns.slice(1)].reverse());
      head = `${first} of ${rest.join(' ')}`;
      adjectives.length = 0;
    } else {
      head = [...nouns].reverse().join(' ');
    }
  }
  return [...[...adjectives].reverse(), head, ...trailing, ...literals]
    .filter((s) => s !== '')
    .join(' ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
