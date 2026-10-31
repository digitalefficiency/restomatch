/**
 * The copy word metric (MECHANISM §5.1/§5.3) — one definition for the auditors, the e2e budget and
 * the unit guard. A word is a letter-led token; numbers, ₪, %, dates and punctuation never count.
 */
export const WORD_RE = /[A-Za-zא-ת][A-Za-zא-ת'"׳״\-]*/g;

/** Number/₪/date placeholders count 0 words; these text placeholders count 1 (a name is a word). */
const TEXT_VARS = ['supplier', 'name', 'item', 'product', 'branch', 'restaurant', 'user', 'role'];
/** Money placeholders: never allowed in an `explain` body (§3.4). */
export const MONEY_VAR_RE = /^(amount|total|sum|price|value|ils|agorot)$|(Amount|Total|Sum|Price|Value|Ils|Agorot)$/;

/** Find the matching `}` for the `{` at `open`. */
function closeOf(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return s.length - 1;
}

/** ICU `{x, plural|select|selectordinal, k {…} …}` → its longest branch (recursively). */
export function icuLongest(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, open);
    const close = closeOf(s, open);
    const inner = s.slice(open + 1, close);
    const head = /^\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/.exec(inner);
    if (!head) {
      out += s.slice(open, close + 1); // a plain {placeholder}
    } else {
      const branches: string[] = [];
      let j = head[0].length;
      while (j < inner.length) {
        const b = inner.indexOf('{', j);
        if (b < 0) break;
        const e = closeOf(inner, b);
        branches.push(icuLongest(inner.slice(b + 1, e)));
        j = e + 1;
      }
      out += branches.reduce((a, b) => (countWords(b) > countWords(a) ? b : a), '');
    }
    i = close + 1;
  }
  return out;
}

export function placeholderNames(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
}

/** Replace placeholders: text vars → one word, everything else (and `#`) → nothing. */
export function resolvePlaceholders(s: string): string {
  return s.replace(/\{(\w+)\}/g, (_, v: string) => (TEXT_VARS.some((t) => v.toLowerCase().includes(t)) ? ' X ' : ' ')).replace(/#/g, ' ');
}

/** The countable text of a catalog value: longest ICU branch, placeholders resolved. */
export function countable(s: string): string {
  return resolvePlaceholders(icuLongest(s));
}

export function countWords(s: string): number {
  return (s.match(WORD_RE) ?? []).length;
}

/** Words of a catalog value (ICU + placeholder rules applied). */
export function catalogWords(s: string): number {
  return countWords(countable(s));
}

/** Sentences with at least one word: split on . ! ? ; and " — ". */
export function sentences(s: string): string[] {
  return countable(s)
    .split(/[.!?;]|\s—\s/)
    .map((x) => x.trim())
    .filter((x) => countWords(x) > 0);
}

/** Normalised text for duplicate detection: no punctuation, no placeholders, single spaces. */
export function normalise(s: string): string {
  return (icuLongest(s).replace(/\{\w+\}/g, ' ').match(WORD_RE) ?? []).join(' ');
}
